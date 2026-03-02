#!/bin/bash
set -e

echo "Building Lattice..."
go build -o /tmp/lattice ./cmd/lattice

echo "Starting Lattice..."
/tmp/lattice server -c examples/lattice.hcl &
LATTICE_PID=$!

# Give Lattice time to start
sleep 2

echo "Testing GetTopology API..."
RESPONSE=$(curl -s -X POST http://localhost:9000/observer.v1.ObserverService/GetTopology \
  -H "Content-Type: application/json" \
  -d '{}')

echo "Response: $RESPONSE"

# Check if response contains "topology"
if echo "$RESPONSE" | grep -q "topology"; then
  echo "✓ GetTopology returned topology data"
else
  echo "✗ GetTopology did not return expected data"
  exit 1
fi

echo "Cleaning up..."
kill $LATTICE_PID 2>/dev/null || true

# Give process time to clean up
sleep 1

echo "✓ API test completed successfully"
