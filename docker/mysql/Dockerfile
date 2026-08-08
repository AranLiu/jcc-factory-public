FROM mysql:26.7.0

# The Compose service uses a named volume whose mount point is already owned by
# mysql. mysqlsh and gosu are therefore unnecessary runtime administration tools.
RUN microdnf remove -y mysql-shell \
    && microdnf clean all \
    && rm -rf /var/cache/dnf \
    && rm -f /usr/local/bin/gosu \
    && install -d -o mysql -g mysql -m 0700 /run/jcc-mysql

USER mysql
