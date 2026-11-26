#!/bin/bash
set -e

BASE_URL="http://localhost:3000"
COUNT=500

echo "Submitting $COUNT webhook events in burst..."
for i in $(seq 1 $COUNT); do
  curl -s -X POST "$BASE_URL/webhooks" \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"burst-$i\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-BURST-$i\",\"simulate\":\"ok\"}}" > /dev/null &
  
  if (( i % 50 == 0 )); then
    echo "Dispatched $i / $COUNT events..."
  fi
done

wait
echo "All $COUNT events submitted successfully! Check http://localhost:3001 to observe workers processing through the queue."
