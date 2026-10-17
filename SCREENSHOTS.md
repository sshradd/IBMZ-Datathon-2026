# LinuxONE evidence checklist

Judges look for screenshots of the LinuxONE instance and the platform capabilities used (containers, security, compute). Capture as you go and save to `docs/screenshots/`.

## Instance and compute

- [ ] `uname -a` and `uname -m` (shows `s390x`)
- [ ] `lscpu` (CPU model, cores; check for any AI accelerator before claiming one)
- [ ] `cat /etc/os-release`
- [ ] `free -h` and `nproc`
- [ ] LinuxONE portal / dashboard page for your instance

## App running on Z

- [ ] `./run.sh` output in the SSH terminal
- [ ] Sidebar badge: "IBM LinuxONE"
- [ ] `curl -s localhost:8000/api/system` output (`"byteorder": "big"`, `"is_ibm_z": true`)
- [ ] Storm replay of Winter Storm Uri mid-stream, honest model, "Out of sample" label visible
- [ ] Prescribe page with the ranked moves and resource planner
- [ ] Diagnose page with one county opened up

## Benchmark

- [ ] `bench/run.py engine --hours 408` output on LinuxONE
- [ ] Same with `--procs` equal to the CPU count
- [ ] Benchmark tab showing laptop vs LinuxONE side by side
- [ ] `top` or `htop` during the multi-process run (all cores busy)

## Containers (if used)

- [ ] `docker build` or `podman build` finishing on s390x
- [ ] `docker ps` with the container running
- [ ] `docker image inspect uri-watch --format '{{.Architecture}}'` (shows `s390x`)

## Security (only what you actually use)

- [ ] Server bound to 127.0.0.1, reached through an SSH tunnel (`ss -tlnp | grep 8000`)
- [ ] Container running as a non-root user (`docker exec <id> id`)
- [ ] Any LinuxONE security feature you enable and can show (e.g. encrypted volume, Secure Execution). Don't claim features you didn't use.
