# Deploying RooRoom

Every push to `main` deploys to the VPS through `.github/workflows/deploy.yml`. GitHub copies
the code to the server over SSH. The server builds the new version while the old one keeps
running, switches over, and checks that the site answers. If it doesn't, the server goes back
to the previous version. The database and uploaded files are kept between deploys.

## One-time setup for a new VPS (Ubuntu 24.04 or 26.04)

Placeholders: `IP` = server address, `HOST` = its hostname (`ssh ubuntu@IP hostname`),
`DOMAIN` = the site's address.

1. **DNS:** add an A record `DOMAIN → IP`. In Cloudflare, use DNS only (grey cloud) so Caddy
   can get the HTTPS certificate.
2. **Server:** copy the setup script over and run it:
   ```sh
   scp deploy/server-setup.sh ubuntu@IP:
   ssh ubuntu@IP "sudo bash server-setup.sh HOST DOMAIN"
   ```
3. **Deploy key:** make a key that only GitHub uses, and let it in:
   ```sh
   ssh-keygen -t ed25519 -N '' -C rooroom-github-deploy -f ~/.ssh/rooroom_deploy
   ssh ubuntu@IP "cat >> ~/.ssh/authorized_keys" < ~/.ssh/rooroom_deploy.pub
   ```
4. **Secrets on the server:** `bash deploy/send-env.sh ubuntu@IP HOST DOMAIN`.
5. **GitHub settings:** under Settings → Secrets and variables → Actions:
   - Secrets:
     - `DEPLOY_SSH_KEY` = contents of `~/.ssh/rooroom_deploy`
     - `VPS_HOST` = `IP`
     - `VPS_HOST_KEY` = output of `ssh-keyscan -t ed25519 IP`
   - Variables:
     - `DOMAIN`
     - `VPS_HOSTNAME` = `HOST`
6. **First deploy:** push to `main`, or click Actions → Deploy to VPS → Run workflow. The first
   deploy also imports the UMKC courses and seeds the demo.

## Before a presentation

```sh
ssh ubuntu@IP 'cd ~/rooroom/current && sh scripts/reset-demo.sh'
```
