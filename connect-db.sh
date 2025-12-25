#!/bin/bash
# Script to connect existing postgres-mealgen container to docker-compose network

set -e

# Get the compose project name (directory name by default)
PROJECT_NAME=${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}

# Find the network created by docker-compose
NETWORK_NAME=$(docker network ls --format "{{.Name}}" | grep -E "^${PROJECT_NAME}_default$|^${PROJECT_NAME}-default$" | head -n 1)

if [ -z "$NETWORK_NAME" ]; then
    echo "Error: Could not find docker-compose network for project '$PROJECT_NAME'"
    echo "Make sure docker-compose services are running first: docker-compose up -d"
    exit 1
fi

echo "Found network: $NETWORK_NAME"

# Check if container exists
if ! docker ps -a --format "{{.Names}}" | grep -q "^postgres-mealgen$"; then
    echo "Error: Container 'postgres-mealgen' not found"
    exit 1
fi

# Check if already connected
if docker inspect postgres-mealgen --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}' | grep -q "$(docker network inspect $NETWORK_NAME --format '{{.Id}}')"; then
    echo "Container 'postgres-mealgen' is already connected to network '$NETWORK_NAME'"
else
    echo "Connecting postgres-mealgen to network $NETWORK_NAME..."
    docker network connect $NETWORK_NAME postgres-mealgen
    echo "Successfully connected!"
fi

