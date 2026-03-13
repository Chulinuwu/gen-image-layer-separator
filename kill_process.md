lsof -i :5001

kill -9 $(lsof -t -i:5001)
