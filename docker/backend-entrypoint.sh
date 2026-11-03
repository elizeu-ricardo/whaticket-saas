
#!/bin/sh
set -e

echo "Waiting for database..."
sleep 10

echo "Running migrations..."
npx sequelize db:migrate

echo "Starting application..."
exec node dist/server.js
