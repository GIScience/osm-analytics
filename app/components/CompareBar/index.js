import React, { Component } from 'react'
import { bindActionCreators } from 'redux'
import { connect } from 'react-redux'
import { queue } from 'd3-queue'
import { polygon, featurecollection } from 'turf'
import * as MapActions from '../../actions/map'
import * as StatsActions from '../../actions/stats'
import { compareTimes as timeOptions } from '../../settings/options'
import unitSystems from '../../settings/unitSystems'
import regionToCoords from '../Map/regionToCoords'
import searchFeatures from '../Stats/searchFeatures'
import UnitSelector from '../UnitSelector'
import Chart from './chart'
import style from './style.css'

class CompareBar extends Component {
  state = {
    featureCounts: {},
    updating: false
  }

  render() {
    const activeLayer = this.props.layers.find(layer => layer.name === this.props.map.filters[0])

    return (
      <div id="compare" className={this.state.updating ? 'updating' : ''}>
        <ul className="metrics before">
        <li>
          <p>{this.props.map.times[0]}</p>
        </li>
        {this.props.map.filters.filter(filter => this.state.featureCounts[filter]).map(filter => {
          return (<li key={activeLayer.name} title={activeLayer.description}>
            <span className="number">{
              numberWithCommas(
                (filter === 'highways' || filter === 'waterways' ? unitSystems[this.props.stats.unitSystem].distance.convert : x=>x)(
                  (this.state.featureCounts[filter].find(counts => counts && counts.id === this.props.map.times[0]) || {}).value
              ))
            }</span><br/>
            {filter === 'highways' || filter === 'waterways'
            ? <UnitSelector
                unitSystem={this.props.stats.unitSystem}
                unit='distance'
                suffix={' of '+this.props.layers.find(f => f.name === filter).title}
                setUnitSystem={this.props.statsActions.setUnitSystem}
              />
            : <span className="descriptor">{this.props.layers.find(f => f.name === filter).title}</span>
            }
          </li>)
        })}
        </ul>
        <ul className="metrics after">
        {this.props.map.filters.filter(filter => this.state.featureCounts[filter]).map(filter => {
          return (<li key={filter} title={this.props.layers.find(f => f.name === filter).description}>
            <span className="number">{
              numberWithCommas(
                (filter === 'highways' || filter === 'waterways' ? unitSystems[this.props.stats.unitSystem].distance.convert : x=>x)(
                  (this.state.featureCounts[filter].find(counts => counts && counts.id === this.props.map.times[1]) || {}).value
              ))
            }</span><br/>
            {filter === 'highways' || filter === 'waterways'
            ? <UnitSelector
                unitSystem={this.props.stats.unitSystem}
                unit='distance'
                suffix={' of '+this.props.layers.find(f => f.name === filter).title}
                setUnitSystem={this.props.statsActions.setUnitSystem}
              />
            : <span className="descriptor">{this.props.layers.find(f => f.name === filter).title}</span>
            }
          </li>)
        })}
        <li>
          <p>{this.props.map.times[1]}</p>
        </li>
        </ul>

        <div className="buttons">
          <button className="compare-toggle" onClick={::this.disableCompareView}>Close Comparison View</button>
        </div>

        <Chart
          layers={this.props.layers}
          before={this.props.map.times[0]}
          after={this.props.map.times[1]}
          data={this.state.featureCounts}
          data_ohsome={this.state.ohsomeFeatureCounts}
        />
      </div>
    )
  }

  componentDidMount() {
    if (this.props.map.region) {
      ::this.update(this.props.map.region, this.props.map.filters)
    }
  }

  componentWillReceiveProps(nextProps) {
    // check for changed map parameters
    if (nextProps.map.region !== this.props.map.region
      || nextProps.map.filters !== this.props.map.filters) {
      ::this.update(nextProps.map.region, nextProps.map.filters)
    }
  }

  update(region, filters) {
    regionToCoords(region)
    .then((function(regionPolygon) {
      this.setState({ updating: true, featureCounts: {}, ohsomeFeatureCounts: {} })
      var q = queue()
      var featureCounts = {}
      var ohsomeFeatureCounts = {}
      filters.forEach(filter => {
        ohsomeFeatureCounts[filter] = []
        let mode = filter === "highways" || filter === "waterways" ? "length" : "count"
        let ohsomeApiRequestUrl = "https://api.ohsome.org/v0.9/elements/" + mode
          + "?time=2008-01-01%2F%2FP1M"
          + "&types=" + (filter === 'amenities' ? 'node,way' : 'way')
          + "&keys=" + (filter === 'amenities' ? 'amenity' : filter.substr(0, filter.length-1))
        switch(region.type) {
          case "bbox":
            ohsomeApiRequestUrl += "&bboxes="+region.coords.join(",")
            break;
          case "polygon":
          case "hot":
            ohsomeApiRequestUrl += "&bpolys=" + encodeURIComponent(JSON.stringify(featurecollection([regionPolygon])))
            break;
        }
        fetch(ohsomeApiRequestUrl)
        .then(res => res.json())
        .then(res => {
          if (res.status && res.status !== 200) return // error from ohsome api
          ohsomeFeatureCounts[filter] = res.result.map(entry => ({
            day: +(new Date(entry.timestamp)),
            value: entry.value * (mode === "length" ? 0.001 : 1)
          }))
          this.setState({
            ohsomeFeatureCounts
          })
        })
        featureCounts[filter] = []
        timeOptions.forEach((timeOption, timeIdx) => {
          if (timeOption.layers && timeOption.layers.indexOf(filter) == -1) return
          q.defer(function(regionPolygon, filter, time, callback) {
            searchFeatures(regionPolygon, filter, time, function(err, data) {
              if (err) callback(err)
              else {
                featureCounts[filter][timeIdx] = {
                  id: timeOption.id,
                  day: +timeOption.timestamp,
                  value: filter === 'highways' || filter === 'waterways'
                    ? data.features.reduce((prev, feature) => prev + (feature.properties._length || 0.0), 0.0)
                    : data.features.reduce((prev, feature) => prev + (feature.properties._count || 1), 0)
                }
                callback(null)
              }
            })
          }, regionPolygon, filter, timeOption.id)
        })
      })
      q.awaitAll(function(err) {
        if (err) throw err
        this.setState({
          featureCounts,
          updating: false
        })
      }.bind(this))
    }).bind(this));
  }

  disableCompareView() {
    this.props.actions.setView('country')
  }
}

function numberWithCommas(x) { // todo: de-duplicate code!
    if (isNaN(Number(x))) return '?'
    return Number(x).toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function mapStateToProps(state) {
  return {
    map: state.map,
    stats: state.stats
  }
}

function mapDispatchToProps(dispatch) {
  return {
    actions: bindActionCreators(MapActions, dispatch),
    statsActions: bindActionCreators(StatsActions, dispatch)
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(CompareBar)
