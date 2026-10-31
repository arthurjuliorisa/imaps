-- Independent optional metadata; historical rows remain NULL.
ALTER TABLE "beginning_balances" ADD COLUMN "ceisa_insw_uom" VARCHAR(20);
