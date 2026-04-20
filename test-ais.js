const WebSocket = require('ws');
const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');

socket.on('open', function() {
  console.log('Connected to AISStream.io!');
  const msg = {
    Apikey: 'df456f63d56ad920a8c5ca2fb473edd42ecc8655',
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [],
    FilterMessageTypes: ['PositionReport']
  };
  socket.send(JSON.stringify(msg));
  console.log('Subscription sent. Waiting for data...');
});

let count = 0;
socket.on('message', function(data) {
  count++;
  if (count <= 5) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.MetaData) {
        console.log('Ship #' + count + ': MMSI=' + parsed.MetaData.MMSI + ' ship_name=' + parsed.MetaData.ship_name);
      } else {
        console.log('Msg #' + count + ': ' + JSON.stringify(parsed).substring(0, 200));
      }
    } catch(e) {
      console.log('Raw #' + count + ': ' + data.toString().substring(0, 200));
    }
  }
  if (count === 10) {
    console.log('SUCCESS: Received ' + count + ' messages. AISStream API is working!');
    socket.close();
    process.exit(0);
  }
});

socket.on('error', function(err) {
  console.log('Error: ' + err.message);
});

socket.on('close', function(code, reason) {
  console.log('Closed: code=' + code + ' reason=' + reason.toString() + ' received=' + count);
  process.exit(count > 0 ? 0 : 1);
});

setTimeout(function() {
  console.log('Timeout after 15s. Received ' + count + ' messages.');
  socket.close();
  process.exit(count > 0 ? 0 : 1);
}, 15000);
