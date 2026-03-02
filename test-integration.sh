#!/bin/bash
set -e

echo "Building binaries..."
cd /Users/erik/code/instruqt/norncorp

# Build lattice
cd lattice
go build -o /tmp/lattice ./cmd/lattice
cd ..

# Build polymorph
cd polymorph
go build -o /tmp/polymorph ./cmd/polymorph
cd ..

echo "Starting Lattice..."
/tmp/lattice server -c lattice/examples/lattice.hcl &
LATTICE_PID=$!

# Give Lattice time to start
sleep 2

echo "Testing empty topology..."
RESPONSE=$(curl -s -X POST http://localhost:9000/observer.v1.ObserverService/GetTopology \
  -H "Content-Type: application/json" \
  -d '{}')
echo "Empty topology: $RESPONSE"

echo "Starting Polymorph with Lattice integration..."
/tmp/polymorph server -c polymorph/examples/with-lattice.hcl &
POLYMORPH_PID=$!

# Give Polymorph time to join the mesh
sleep 3

echo "Testing topology with Polymorph..."
RESPONSE=$(curl -s -X POST http://localhost:9000/observer.v1.ObserverService/GetTopology \
  -H "Content-Type: application/json" \
  -d '{}')
echo "Topology with Polymorph: $RESPONSE"

# Check if response contains the service
if echo "$RESPONSE" | grep -q "api"; then
  echo "✓ Polymorph service 'api' found in topology"
else
  echo "✗ Polymorph service 'api' not found in topology"
  kill $POLYMORPH_PID $LATTICE_PID 2>/dev/null || true
  exit 1
fi

# Check if response contains service type
if echo "$RESPONSE" | grep -q "http"; then
  echo "✓ Service type 'http' found in topology"
else
  echo "✗ Service type 'http' not found in topology"
  kill $POLYMORPH_PID $LATTICE_PID 2>/dev/null || true
  exit 1
fi

echo "Cleaning up..."
kill $POLYMORPH_PID 2>/dev/null || true
kill $LATTICE_PID 2>/dev/null || true

# Give processes time to clean up
sleep 2

echo "✓ Integration test completed successfully"
