import * as dns from 'dns';

/**
 * Opt-in workaround for environments whose local DNS resolver can't resolve KRA's
 * sandbox host (confirmed SERVFAIL from this dev machine's resolver even though the
 * host itself is reachable via public DNS). Only active when ETIMS_DNS_OVERRIDE_SERVERS
 * is set, so it never changes behavior in environments with working DNS.
 */
export function applyDnsOverrideIfConfigured(): void {
  const serversEnv = process.env.ETIMS_DNS_OVERRIDE_SERVERS;
  if (!serversEnv) return;

  const servers = serversEnv.split(',').map((s) => s.trim()).filter(Boolean);
  if (servers.length === 0) return;

  const resolver = new dns.Resolver();
  resolver.setServers(servers);
  const originalLookup = dns.lookup;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = (
    hostname: string,
    options: unknown,
    callback?: unknown,
  ) => {
    let opts = options as (dns.LookupOneOptions & { all?: boolean }) | undefined;
    let cb = callback as
      | ((err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void)
      | undefined;
    if (typeof opts === 'function') {
      cb = opts as unknown as typeof cb;
      opts = undefined;
    }
    resolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalLookup as any)(hostname, options, callback);
      }
      if (opts?.all) {
        return cb?.(
          null,
          addresses.map((a) => ({ address: a, family: 4 })),
        );
      }
      cb?.(null, addresses[0], 4);
    });
  };

  console.warn(
    `[dns-override] Using ${servers.join(', ')} for DNS resolution (ETIMS_DNS_OVERRIDE_SERVERS set)`,
  );
}
