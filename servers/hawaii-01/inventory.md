# Inventory — hawaii-01

Stub — populate from the next snapshot. See
[`snapshots/2026-04-27/`](snapshots/2026-04-27/) once raw output is committed.

## Hardware

- CPU: _from `host/lscpu.txt` and `host/cpuinfo.txt`_
- Memory: _from `host/meminfo.txt`_
- Disks: _from `host/lsblk.txt` and `fs/df.txt`_
- System info: _from `host/dmidecode.txt` if present_

## OS

- Distribution / version: _from `host/identity.txt` and `/etc/os-release`_
- Kernel: _from `host/identity.txt` (`uname -a`)_
- Timezone: _from `host/identity.txt`_

## Network

- Interfaces & addresses: _from `network/ip-addr.txt`_
- Routes: _from `network/ip-route.txt`_
- DNS resolver: _from `network/resolv.txt`_
- Firewall: _from `network/{ufw,iptables,nft,firewalld}.txt`_
- Listening ports: _from `network/listening.txt`_

## Users & access

- Local users: _from `access/passwd.txt`_
- Sudoers: _from `access/sudoers.txt` and `access/etc/sudoers.d/`_
- SSH config: _from `access/etc/sshd_config`_
- Authorized keys: _from `access/authorized_keys.txt`_

## Packages

- Distro packages: _from `packages/dpkg.txt` (or `packages/rpm.txt`)_
- Snap / flatpak: _from `packages/{snap,flatpak}.txt`_
- Language ecosystems: _from `packages/{pip3-global,npm-global,gem-global}.txt`_
- Runtime versions: _from `packages/runtime-versions.txt`_

## Filesystem

- Mounts: _from `fs/mounts.txt` and `fs/fstab.txt`_
- Disk usage: _from `fs/df.txt`_
- Application directories: _from `fs/listing-*.txt`_
- Largest files: _from `fs/largest-files.txt`_
