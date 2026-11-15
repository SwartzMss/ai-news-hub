CREATE TABLE newsletter_digest_page_leases (
  day TEXT PRIMARY KEY REFERENCES newsletter_digests(day),
  owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL
) STRICT;
