import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INSW_SETTINGS = [
  {
    endpoint_key: 'PEMASUKAN',
    endpoint_name: 'Pemasukan Barang',
    description: 'Transmisi data pemasukan barang (incoming goods) ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'PENGELUARAN',
    endpoint_name: 'Pengeluaran Barang',
    description: 'Transmisi data pengeluaran barang (outgoing goods) ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'MATERIAL_USAGE',
    endpoint_name: 'Pemakaian Bahan',
    description: 'Transmisi data pemakaian bahan (material usage) ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'PRODUCTION_OUTPUT',
    endpoint_name: 'Hasil Produksi',
    description: 'Transmisi data hasil produksi (production output) ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'SCRAP_IN',
    endpoint_name: 'Scrap Masuk',
    description: 'Transmisi data scrap masuk ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'SCRAP_OUT',
    endpoint_name: 'Scrap Keluar',
    description: 'Transmisi data scrap keluar ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'CAPITAL_GOODS_OUT',
    endpoint_name: 'Barang Modal Keluar',
    description: 'Transmisi data barang modal keluar ke INSW. Auto-trigger saat data WMS diterima.',
  },
  {
    endpoint_key: 'SALDO_AWAL',
    endpoint_name: 'Saldo Awal',
    description: 'Transmisi data saldo awal (beginning balance) ke INSW. Trigger manual.',
  },
  {
    endpoint_key: 'SALDO_AWAL_FINAL',
    endpoint_name: 'Registrasi Final Saldo Awal',
    description: 'Registrasi final saldo awal ke INSW (lock/finalize). Trigger manual.',
  },
];

export async function seedINSWSettings() {
  console.log('Seeding INSW Integration Settings...');

  let upsertedCount = 0;

  for (const setting of INSW_SETTINGS) {
    await prisma.insw_integration_settings.upsert({
      where: { endpoint_key: setting.endpoint_key },
      update: {
        endpoint_name: setting.endpoint_name,
        description: setting.description,
      },
      create: {
        endpoint_key: setting.endpoint_key,
        endpoint_name: setting.endpoint_name,
        description: setting.description,
        is_enabled: true,
      },
    });
    upsertedCount++;
    console.log(`  Upserted: ${setting.endpoint_key} (${setting.endpoint_name})`);
  }

  console.log(`Completed: ${upsertedCount} INSW integration settings seeded\n`);
}
