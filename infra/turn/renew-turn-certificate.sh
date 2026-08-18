#!/bin/sh
set -eu

certbot renew --quiet --deploy-hook /usr/local/sbin/rcmania-turn-reload
