import * as request from 'superagent'
import vt from 'vector-tile'
import Protobuf from 'pbf'
import { extent, intersect, bboxPolygon, featurecollection, centroid, within } from 'turf'
import Sphericalmercator from 'sphericalmercator'
import { queue } from 'd3-queue'

var cache = {} // todo: cache invalidation
var merc = new Sphericalmercator({size: 512})

function fetch(region, callback) {
  const zoom = getRegionZoom(region)
  const tiles = getRegionTiles(region, zoom)
  const toLoad = tiles.filter(tile => cache[tile.hash] === undefined)
  var q = queue(4) // max 4 concurrently loading tiles in queue
  toLoad.forEach(tile => q.defer(getAndCacheTile, tile))
  q.awaitAll(function(err) {
    if (err) return callback(err)
    // return matching features
    var output = []
    const regionFc = featurecollection([region])
    tiles.forEach(tile => {
      output = output.concat(
        within(cache[tile.hash], regionFc).features
      )
    })
    // todo: handle tile boundaries / split features (merge features with same osm id)
    callback(null, featurecollection(output))
  })
}

function getRegionZoom(region) {
  const maxZoom = 14 // todo: setting "maxZoom"
  const tileLimit = 24 // todo: setting "tileLimit"
  const regionBounds = extent(region)
  for (let z=maxZoom; z>0; z--) {
    let tileBounds = merc.xyz(regionBounds, z)
    let tilesNum = (1 + tileBounds.maxX - tileBounds.minX) * (1 + tileBounds.maxY - tileBounds.minY)
    if (tilesNum <= tileLimit) {
      return z
    }
  }
  return 0
}

function getRegionTiles(region, zoom) {
  const regionBounds = extent(region)
  var tiles = []
  // get all tiles for the regions bbox
  var tileBounds = merc.xyz(regionBounds, zoom)
  for (let x=tileBounds.minX; x<=tileBounds.maxX; x++) {
    for (let y=tileBounds.minY; y<=tileBounds.maxY; y++) {
      tiles.push({
        x,
        y,
        zoom,
        hash: x+'/'+y+'/'+zoom
      })
    }
  }
  // drop tiles that are actually outside the region
  tiles = tiles.filter(tile =>
    intersect(
      bboxPolygon(merc.bbox(tile.x, tile.y, tile.zoom)),
      region
    ) !== undefined
  )
  return tiles
}

function getAndCacheTile(tile, callback) {
  loadTile(tile, function(err, data) {
    if (err) return callback(err)
    // convert features to centroids, store tile data in cache
    data.features = data.features.map(feature => {
      var centr = centroid(feature)
      centr.properties = feature.properties
      return centr
    })
    cache[tile.hash] = data
    callback(null) // don't return any actual data as it is available via the cache already
  })
}

function parseTile(tile, data, callback) {
  const layer = data.layers['osm'] // todo: settings?
  var features = []
  if (layer) {
    for (let i=0; i<layer.length; i++) {
      let feature = layer.feature(i)
      features.push(feature.toGeoJSON(tile.x, tile.y, tile.zoom))
    }
  }
  callback(null, featurecollection(features))
}
function loadTile(tile, callback) {
  // based on https://github.com/mapbox/mapbox-gl-js/blob/master/js/source/worker.js
  var url = 'http://52.50.120.37:7778/v2/tiles/'+tile.zoom+'/'+tile.x+'/'+tile.y+'.pbf' // todo: ->settings

  getArrayBuffer(url, function done(err, data) {
    if (err) return callback(err)
    if (data === null) return callback(null, featurecollection([]))
    data = new vt.VectorTile(new Protobuf(new Uint8Array(data)))
    parseTile(tile, data, callback)
  })
}
function getArrayBuffer(url, callback) {
  // todo: global?
  request.parse['application/x-protobuf'] = obj => obj
  request.get(url)
  .on('request', function () {
    // todo: needed?
    // todo: check browser compat?? xhr2??? see https://github.com/visionmedia/superagent/pull/393 + https://github.com/visionmedia/superagent/pull/566
    this.xhr.responseType = 'arraybuffer' // or blob
  })
  .end(function(err,res) {
    // now res.body is an arraybuffer or a blob
    if (!err && res.status >= 200 && res.status < 300) {
      callback(null, res.body)
    } else if (res.status === 404) {
      callback(null, null)
    } else {
      callback(error || new Error(res.status))
    }
  });
};

export default fetch