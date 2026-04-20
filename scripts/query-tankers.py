import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'intel-board.db')
conn = sqlite3.connect(db_path)

print("=== Tanker/transport entries in aircraft_registry ===")
cur = conn.execute("""
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
""")
for row in cur.fetchall():
    print(row)

print("\n=== Military tanker flights (joined with registry) ===")
cur2 = conn.execute("""
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
""")
for row in cur2.fetchall():
    print(row)

print("\n=== All distinct icao_type_codes starting with K ===")
cur3 = conn.execute("""
  SELECT DISTINCT icao_type_code, COUNT(*) as cnt 
  FROM aircraft_registry 
  WHERE icao_type_code LIKE 'K%' 
  GROUP BY icao_type_code
""")
for row in cur3.fetchall():
    print(row)

conn.close()