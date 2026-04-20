const Database = require('better-sqlite3')
const db = new Database('./data/intel-board.db')

const rows = db.prepare(`
  SELECT icao24, icao_type_code, aircraft_type, operator 
  FROM aircraft_registry 
  WHERE aircraft_type LIKE '%KC-%' 
     OR aircraft_type LIKE '%tanker%' 
     OR aircraft_type LIKE '%MRTT%'
     OR aircraft_type LIKE '%767%'
     OR aircraft_type LIKE '%A400%'
     OR aircraft_type LIKE '%Atlas%'
     OR icao_type_code LIKE 'K%'
     OR icao_type_code LIKE 'KC%'
     OR icao_type_code LIKE 'A33%'
     OR icao_type_code LIKE 'A40%'
  ORDER BY aircraft_type
`).all()

console.log('Tanker/transport entries in aircraft_registry:')
console.log(JSON.stringify(rows, null, 2))

// Also check what flights table has for these
const flights = db.prepare(`
  SELECT f.icao24, f.callsign, f.aircraft_type, f.is_military, ar.icao_type_code, ar.aircraft_type as reg_aircraft_type
  FROM flights f
  LEFT JOIN aircraft_registry ar ON f.icao24 = ar.icao24
  WHERE f.is_military = 1
    AND (f.aircraft_type LIKE '%KC-%' 
     OR f.aircraft_type LIKE '%tanker%' 
     OR f.aircraft_type LIKE '%MRTT%'
     OR f.aircraft_type LIKE '%767%'
     OR f.aircraft_type LIKE '%A400%'
     OR ar.aircraft_type LIKE '%KC-%'
     OR ar.aircraft_type LIKE '%tanker%'
     OR ar.aircraft_type LIKE '%MRTT%'
     OR ar.icao_type_code LIKE 'K%')
  ORDER BY f.timestamp DESC
  LIMIT 20
`).all()

console.log('\nMilitary tanker flights:')
console.log(JSON.stringify(flights, null, 2))

db.close()