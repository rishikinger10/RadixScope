# Local Redis setup

RadixScope uses one native Redis instance on loopback. It stores only temporary
run and polling state.

```bash
sudo apt update
sudo apt install -y redis-server
redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no
```

Leave that terminal open. In another terminal:

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
```

Expected result: `PONG`.

Then, from `server/`:

```bash
cp .env.example .env
npm run test:redis
```

The integration test uses a five-second TTL and does not require SGLang or the
GPU.
