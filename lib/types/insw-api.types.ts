export interface INSWApiHeaders {
  'x-insw-key': string;
  'x-unique-key': string;
}

export enum INSWActivityCode {
  PEMASUKAN = '30',
  PENGELUARAN = '31',
  STOCK_OPNAME = '32',
  ADJUSTMENT = '33',
}

export enum INSWItemCategory {
  BAHAN_BAKU = '1',
  BAHAN_PENOLONG = '2',
  BAHAN_HABIS_PAKAI = '3',
  BARANG_DAGANGAN = '4',
  MESIN_PERALATAN = '5',
  BARANG_DALAM_PROSES = '6',
  BARANG_JADI = '7',
  BARANG_REJECT_SCRAP = '8',
}

export interface INSWDocumentItem {
  kodeDokumen: string;
  nomorDokumen: string;
  tanggalDokumen: string;
}

export interface INSWBarangTransaksi {
  kdKategoriBarang: string;
  kdBarang: string;
  uraianBarang: string;
  jumlah: number;
  kdSatuan: string;
  nilai: number;
  dokumen: INSWDocumentItem[];
}

export interface INSWDokumenKegiatan {
  nomorDokKegiatan: string;
  tanggalKegiatan: string;
  namaEntitas: string;
  keterangan?: string;
  barangTransaksi: INSWBarangTransaksi[];
}

export interface INSWTransaksiData {
  kdKegiatan: string;
  dokumenKegiatan: INSWDokumenKegiatan[];
}

export interface INSWTransaksiPayload {
  data: INSWTransaksiData[];
}

export interface INSWBarangSaldo {
  kd_kategori_barang: string;
  kd_barang: string;
  uraian_barang: string;
  jumlah: number;
  satuan: string;
  nilai: number;
  tanggal_declare: string;
}

export interface INSWSaldoAwalPayload {
  data: {
    no_kegiatan: string;
    tgl_kegiatan: string;
    barangSaldo: INSWBarangSaldo[];
  };
}

export interface INSWApiResponse<T = any> {
  code: string;
  status: boolean;
  message: string;
  data: T;
}

export interface INSWBarangTransaksiResponse {
  idBarangTransaksi: string;
  kdKategoriBarang: string;
  kdBarang: string;
  uraianBarang: string;
  jumlah: string;
  kdSatuan: string;
  nilai: string;
  dokumen: INSWDocumentItem[];
}

export interface INSWTransaksiResponse {
  idTransaksi: string;
  kdKegiatan: string;
  nomorDokKegiatan: string;
  tanggalKegiatan: string;
  namaEntitas: string;
  barangTransaksi: INSWBarangTransaksiResponse[];
}

export interface INSWGetDataParams {
  tglAwal: string;
  tglAkhir: string;
}

export interface INSWEndpoints {
  saldoAwal: {
    temp: string;
    real: string;
  };
  registrasi: {
    temp: string;
  };
  transaksi: {
    temp: string;
    real: string;
  };
  dokumen: {
    temp: string;
    real: string;
  };
}

export const INSW_ENDPOINTS: INSWEndpoints = {
  saldoAwal: {
    temp: 'https://api.insw.go.id/api-prod/inventory/temp/saldoAwal',
    real: 'https://api.insw.go.id/api-prod/inventory/saldoAwal',
  },
  registrasi: {
    temp: 'https://api.insw.go.id/api-prod/inventory/temp/registrasi',
  },
  transaksi: {
    temp: 'https://api.insw.go.id/api-prod/inventory/temp/transaksi',
    real: 'https://api.insw.go.id/api-prod/inventory/transaksi',
  },
  dokumen: {
    temp: 'https://api.insw.go.id/api-prod/inventory/temp/transaksi/dokumen',
    real: 'https://api.insw.go.id/api-prod/inventory/transaksi/dokumen',
  },
};

export const ITEM_TYPE_TO_INSW_CATEGORY: Record<string, string> = {
  ROH: INSWItemCategory.BAHAN_BAKU,
  HALB: INSWItemCategory.BAHAN_BAKU,
  HIBE: INSWItemCategory.BAHAN_PENOLONG,
  FERT: INSWItemCategory.BARANG_JADI,
  'HIBE-M': INSWItemCategory.MESIN_PERALATAN,
  'HIBE-E': INSWItemCategory.MESIN_PERALATAN,
  'HIBE-T': INSWItemCategory.MESIN_PERALATAN,
  SCRAP: INSWItemCategory.BARANG_REJECT_SCRAP,
  WIP: INSWItemCategory.BARANG_DALAM_PROSES,
};
