#!/bin/bash
set -e

BASE_URL="http://localhost:3000"

echo "=========================================================="
echo "      Reliable Webhook Processor - Demo Scenarios"
echo "=========================================================="

echo ""
echo "1. Core Scenario: Duplicate Delivery (Same eventId sent 3 times simultaneously)"
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-dup-1","type":"order.created","data":{"orderId":"ORD-DUP-1","simulate":"ok"}}' &
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-dup-1","type":"order.created","data":{"orderId":"ORD-DUP-1-DIFF","simulate":"ok"}}' &
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-dup-1","type":"order.created","data":{"orderId":"ORD-DUP-1","simulate":"ok"}}' &
wait
echo "--> Submitted duplicates. Both return 202 Accepted. processed_orders will contain exactly 1 row."

echo ""
echo "2. Core Scenario: Temporary Failure (fail_then_succeed:2)"
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-temp-fail-1","type":"order.created","data":{"orderId":"ORD-TEMP-1","simulate":"fail_then_succeed:2"}}'
echo "--> Submitted temporary failure event. It will fail twice and succeed on attempt #3."

echo ""
echo "3. Core Scenario: Permanent Failure (always_fail)"
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-perm-fail-1","type":"order.created","data":{"orderId":"ORD-PERM-1","simulate":"always_fail"}}'
echo "--> Submitted permanent failure event. It will retry with backoff and stop at max attempts (status: FAILED)."

echo ""
echo "4. Core Scenario: Parallel Processing (Multiple slow events)"
for i in {1..4}; do
  curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
    -d "{\"eventId\":\"demo-parallel-$i\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-PAR-$i\",\"simulate\":\"slow:4\"}}" &
done
wait
echo "--> Submitted 4 slow jobs concurrently. Worker-1 and Worker-2 will process them simultaneously without collisions."

echo ""
echo "5. Core Scenario: Worker Crash Recovery"
echo "Submitting slow event: demo-crash-1..."
curl -s -X POST "$BASE_URL/webhooks" -H "Content-Type: application/json" \
  -d '{"eventId":"demo-crash-1","type":"order.created","data":{"orderId":"ORD-CRASH-1","simulate":"slow:25"}}'
echo "--> To test crash recovery now: run 'docker kill webhook-worker-1'."
echo "--> After the 15-second lease expires, webhook-worker-2 will automatically reclaim it and complete it without duplicating processed_orders."

echo ""
echo "=========================================================="
echo "All test scenarios dispatched! Check the dashboard at:"
echo "http://localhost:3001"
echo "=========================================================="
