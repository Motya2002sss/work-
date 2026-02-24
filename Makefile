.PHONY: run smoke

run:
	python3 backend/server.py

smoke:
	curl -s http://127.0.0.1:8080/api/health
