# DigitalOcean Deploy Plan

## Step 1: Create Droplet

- **Size**: Basic $6/mo (1 vCPU, 1GB RAM, 25GB SSD)
- **Region**: NYC1 or SFO3 (close to you / Bebop servers)
- **Image**: Ubuntu 24.04 LTS
- **Auth**: SSH key (add your pubkey)
- **Hostname**: `greek-mm` or similar

## Step 2: Initial Server Setup (run once)

SSH into the droplet and run:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Install Docker Compose plugin (included with modern Docker)
docker compose version  # verify

# Clone repo
git clone <your-repo-url> /opt/greek
cd /opt/greek/market-maker

# Create .env from your local values
nano .env  # paste your env vars

# Build and start
docker compose up -d --build

# Verify
docker compose ps
docker compose logs -f
```

## Step 3: Deploy Updates (run from local machine)

Simple SSH + pull + rebuild:

```bash
DROPLET_IP=your.ip.here

ssh root@$DROPLET_IP "cd /opt/greek && git pull && cd market-maker && docker compose up -d --build"
```

Or add to market-maker/package.json:
```json
"deploy": "ssh root@$DROPLET_IP 'cd /opt/greek && git pull && cd market-maker && docker compose up -d --build'"
```

## Step 4: Monitor

```bash
# View logs
ssh root@$DROPLET_IP "cd /opt/greek/market-maker && docker compose logs -f"

# Check status
ssh root@$DROPLET_IP "cd /opt/greek/market-maker && docker compose ps"

# Restart a service
ssh root@$DROPLET_IP "cd /opt/greek/market-maker && docker compose restart bebop"
```

## Step 5: Point Frontend to Relay

Update your frontend's WebSocket URL to point to the droplet:

```
ws://<DROPLET_IP>:3004
```

Or if you add TLS later:
```
wss://mm.yourdomain.com
```

## Optional: Add TLS with Caddy

If the frontend needs `wss://` (required if frontend is on HTTPS):

```bash
apt install caddy

# /etc/caddy/Caddyfile
mm.yourdomain.com {
    reverse_proxy localhost:3004
}

systemctl restart caddy
```

Caddy auto-provisions Let's Encrypt certs. Point DNS A record to droplet IP first.

## Cost Comparison

| | Railway | DigitalOcean |
|---|---------|-------------|
| 2 services, always-on | ~$10-20+/mo | $6/mo |
| Scaling | Auto (expensive) | Manual (cheap) |
| Deploy | Git push | SSH + docker compose |
| Logs | Dashboard | `docker compose logs` |
| TLS | Built-in | Add Caddy (~5 min) |

## Rollback

```bash
# On droplet
cd /opt/greek
git log --oneline -5        # find good commit
git checkout <commit>
cd market-maker
docker compose up -d --build
```
