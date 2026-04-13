FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy only runtime-relevant files
COPY server.py gunicorn.conf.py VERSION ./
COPY static/ ./static/

# config-templates/ and state/ are mounted as volumes at runtime
RUN mkdir -p config-templates state

EXPOSE 8080

CMD ["gunicorn", "-c", "gunicorn.conf.py", "server:app"]
