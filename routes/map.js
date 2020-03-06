var express = require('express');
var router = express.Router();
var query_overpass = require('query-overpass');
var request = require("request");

console.log("Launching Thirsty Ottawa...");
//console.log("Args: " + process.argv);

var queryOpendataDrinkingWater=false;
var queryOpenStreetmapToilets=true;
var queryOpenStreetmapDrinkingWater=true;

var odoData = [];
var osmData = [];

var googleapikey = "AIzaSyAzf46rIYu-VSBJFixUYZwz__jpAN1Qqjw";

// parse variables
const yargs = require('yargs');
const argv = yargs
    .option('googleapikey', {
        alias: 'g',
        description: 'Override built-in google api key.',
        type: 'String',
    })
    .argv;

if(argv.googleapikey) {
  googleapikey = argv.googleapikey;
  console.log("Overriding google api key with: " + googleapikey);
}



// this will get data from open data ottawa
// this is disabled by default as all the data is in open street maps (as of Jul 30, 2019)
// can load via:
// http://localhost:3000/thirsty?fetchodo=1
// note that this data should not be cached.
function fetchFromOpendataOttawa(res, onCompletion) {
  var ottawaDataUrl = "http://data.ottawa.ca/api/action/datastore_search?resource_id=1832175d-54e9-422d-8e63-705f157b7352"; //&limit=5"

  request(ottawaDataUrl, function (error, response, body) {
    console.error('error:', error);
    console.log('statusCode:', response && response.statusCode);

    var odoResult = JSON.parse(body);
    var fetchedOdoData = odoResult['result']['records'];
    if(fetchedOdoData) {
      odoData = fetchedOdoData;
    }
    //console.log('odo data: ', JSON.stringify(odoData));
    onCompletion(res);
  });
}

// render the map using pug - and yes, this is MY api key, don't
// bother trying to steal and spam with it, it's use is geofenced
function renderMap(res) {
  res.render('map', {
    title: 'Drinking Fountains of Ottawa',
    OSMDATA: JSON.stringify(osmData['features']),
    OPODATA: JSON.stringify(odoData),
    GOOGLEAPIKEY: googleapikey});
}

// cache the odo data for a period of time
class OsmDataCache {
  constructor() {
    this.osmDataCache = "";
    this.osmDataCacheDate = null;
    this.osmDataTTL = 60 * 1000;
  }
}
var osmDataCaches = {};

// pull the open street map data from the overpass api
function fetchOverpassData(req, res, onCompletion) {
  console.log("Request received, about to query overpass...");

  // a decent sized square around ottawa area,
  // query for the drinking water OR toilet amenities
  var location = "ottawa";
  var ql = 'node(45.1,-75.8,45.5,-75.5)[amenity~"drinking_water|toilets"];out meta;';

  // minor hack to load toronto
  if(req.query.toronto) {
    location = "toronto";
    console.log("Toronto requested...");
    var toronto = [43.661768, -79.425454];
    ql = 'node(' + (toronto[0] - 0.3) +
      ',' + (toronto[1] - 0.2) +
      ',' + (toronto[0] + 0.3) +
      ',' + (toronto[1] + 0.2) +
      ')[amenity~"drinking_water|toilets"];out meta;';
  }
  if(req.query.sydney) {
    location = "sydney";
    console.log("Sydney requested...");
    var sydney = [-33.869278, 151.200302];
    ql = 'node(' + (sydney[0] - 0.35) +
      ',' + (sydney[1] - 0.35) +
      ',' + (sydney[0] + 0.35) +
      ',' + (sydney[1] + 0.35) +
      ')[amenity~"drinking_water|toilets"];out meta;';
  }

  query_overpass(ql, function(error, fetchedOsmData) {
    console.log("overpass query done, error: " + error); // + ", keylen: " + Object.keys(fetchedOsmData).length);
    osmData = fetchedOsmData;
    if(req.query.dumptoconsole) {
      console.log("osmdata w meta: " + JSON.stringify(osmData));
    }

    if(error) {
      console.log("Error from overpass, not updating cache.");
    } else {
      // update the cache always
      var cachedData = new OsmDataCache();
      cachedData.osmDataCache = osmData;
      cachedData.osmDataCacheDate = Date.now();
      osmDataCaches[location] = cachedData
      //osmDataCache = osmData;
      //osmDatacacheLocation = location
      //osmDataCacheDate = Date.now();
      console.log("Cache updated as of now: " + cachedData.osmDataCacheDate);
    }

    onCompletion(req, res);
  });
}

// after we have (either via cache or by pulling it) the open street map data
// from overpass, either carry on with render, or get open street map data
function afterOSM(req, res) {
  console.log("request query.fetchodo: " + req.query.fetchodo);
  if(queryOpendataDrinkingWater || (req.query.fetchodo && req.query.fetchodo == true)) {
    console.log("Asked to fetch open data ottawa data.");
    fetchFromOpendataOttawa(res, renderMap);
  } else {
    console.log("Not getting open data ottawa data.");
    renderMap(res);
  }
}

function parseLocation(req) {
  if(req.query.toronto) {
    return "toronto";
  }
  if(req.query.sydney) {
    return "sydney";
  }
  return "ottawa";
}


//
// main GET method, entry point for the whole shabang
//

var cacheRequestInProgress = false;
router.get('/', function(req, res, next) {

  // if we have any data cached at all, we use it, then spawn to update.
  // this way only the first request ever is slow.
  var location = parseLocation(req);
  var cachedData = osmDataCaches[location];
  if(cachedData) {
    var ttl = Date.now() - cachedData.osmDataTTL;
    if(!cachedData.osmDataCacheDate || (cachedData.osmDataCacheDate < ttl)) {
      console.log("cache is expired at " + ttl + ", may query OSM synchronously, in progress: " + cacheRequestInProgress);
      if(!cacheRequestInProgress) {
        console.log("Making cache request.");
        cacheRequestInProgress = true;
        fetchOverpassData(req, res, () => {
          // do nothing!
          console.log("Done filling the cache.");
          cacheRequestInProgress = false;
        });
      } else {
        console.log("Not making cache request, one in progress.");
      }
    } else {
      console.log("cache is still good til " + ttl + ", not querying OSM asynchronously");
    }

    // load from the cache
    osmData = cachedData.osmDataCache;

    // and proceed
    afterOSM(req, res);

  } else {

    // call as per normal, there is no cache we can use
    console.log("Cache isn't active, going sync");
    fetchOverpassData(req, res, afterOSM);
  }

});

module.exports = router;
