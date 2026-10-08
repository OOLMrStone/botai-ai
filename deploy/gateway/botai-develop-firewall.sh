#!/bin/sh
set -eu
# Atomic replacement: no empty-chain window during updates.
iptables-restore --wait 5 --noflush <<'EOF'
*filter
:BOTAI_DEV - [0:0]
-F BOTAI_DEV
-A BOTAI_DEV -m conntrack --ctstate ESTABLISHED --ctdir REPLY -j ACCEPT
-A BOTAI_DEV -d 127.0.0.0/8 -p udp --dport 53 -j ACCEPT
-A BOTAI_DEV -d 127.0.0.0/8 -p tcp --dport 53 -j ACCEPT
-A BOTAI_DEV -d 127.0.0.1 -p tcp -m multiport --dports 8091,18080 -j ACCEPT
-A BOTAI_DEV -m addrtype --dst-type LOCAL -j REJECT
-A BOTAI_DEV -d 0.0.0.0/8 -j REJECT
-A BOTAI_DEV -d 10.0.0.0/8 -j REJECT
-A BOTAI_DEV -d 100.64.0.0/10 -j REJECT
-A BOTAI_DEV -d 127.0.0.0/8 -j REJECT
-A BOTAI_DEV -d 169.254.0.0/16 -j REJECT
-A BOTAI_DEV -d 172.16.0.0/12 -j REJECT
-A BOTAI_DEV -d 192.168.0.0/16 -j REJECT
-A BOTAI_DEV -d 224.0.0.0/4 -j REJECT
-A BOTAI_DEV -j RETURN
COMMIT
EOF
for identity in 1000 100000-165535; do
 iptables -w -C OUTPUT -m owner --uid-owner "$identity" -j BOTAI_DEV 2>/dev/null || iptables -w -I OUTPUT 1 -m owner --uid-owner "$identity" -j BOTAI_DEV
 ip6tables -w -C OUTPUT -m owner --uid-owner "$identity" -j REJECT 2>/dev/null || ip6tables -w -I OUTPUT 1 -m owner --uid-owner "$identity" -j REJECT
done
