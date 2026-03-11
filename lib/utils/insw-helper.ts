import { format } from 'date-fns';
import {
  INSWTransaksiPayload,
  INSWActivityCode,
  INSWDokumenKegiatan,
  INSWBarangTransaksi,
  ITEM_TYPE_TO_INSW_CATEGORY,
} from '@/lib/types/insw-api.types';

export interface StockOpnameItem {
  doc_number: string;
  doc_date: Date;
  entity_name: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  quantity: number;
  value_amount: number;
}

export interface AdjustmentItem {
  doc_number: string;
  doc_date: Date;
  entity_name: string;
  keterangan?: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  quantity: number;
  value_amount: number;
}

export class INSWHelper {
  static formatINSWDate(date: Date): string {
    return format(date, 'dd-MM-yyyy HH:mm:ss.SSS');
  }

  static formatINSWDateOnly(date: Date): string {
    return format(date, 'dd-MM-yyyy');
  }

  static mapItemTypeToINSWCategory(itemType: string): string {
    return ITEM_TYPE_TO_INSW_CATEGORY[itemType] || '1';
  }

  static convertStockOpnameToINSW(
    items: StockOpnameItem[]
  ): INSWTransaksiPayload {
    const groupedByDoc = new Map<string, StockOpnameItem[]>();

    items.forEach((item) => {
      const key = `${item.doc_number}_${format(item.doc_date, 'yyyy-MM-dd')}`;
      if (!groupedByDoc.has(key)) {
        groupedByDoc.set(key, []);
      }
      groupedByDoc.get(key)!.push(item);
    });

    const dokumenKegiatan: INSWDokumenKegiatan[] = Array.from(
      groupedByDoc.values()
    ).map((group) => ({
      nomorDokKegiatan: group[0].doc_number,
      tanggalKegiatan: this.formatINSWDateOnly(group[0].doc_date),
      namaEntitas: group[0].entity_name,
      barangTransaksi: group.map((item) => ({
        kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
        kdBarang: item.item_code,
        uraianBarang: item.item_name,
        jumlah: item.quantity,
        kdSatuan: item.uom,
        nilai: item.value_amount,
        dokumen: [
          {
            kodeDokumen: '0407632',
            nomorDokumen: item.doc_number,
            tanggalDokumen: this.formatINSWDateOnly(item.doc_date),
          },
        ],
      })),
    }));

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.STOCK_OPNAME,
          dokumenKegiatan,
        },
      ],
    };
  }

  static convertAdjustmentToINSW(
    items: AdjustmentItem[]
  ): INSWTransaksiPayload {
    const groupedByDoc = new Map<string, AdjustmentItem[]>();

    items.forEach((item) => {
      const key = `${item.doc_number}_${format(item.doc_date, 'yyyy-MM-dd')}`;
      if (!groupedByDoc.has(key)) {
        groupedByDoc.set(key, []);
      }
      groupedByDoc.get(key)!.push(item);
    });

    const dokumenKegiatan: INSWDokumenKegiatan[] = Array.from(
      groupedByDoc.values()
    ).map((group) => ({
      nomorDokKegiatan: group[0].doc_number,
      tanggalKegiatan: this.formatINSWDateOnly(group[0].doc_date),
      namaEntitas: group[0].entity_name,
      keterangan: group[0].keterangan,
      barangTransaksi: group.map((item) => ({
        kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
        kdBarang: item.item_code,
        uraianBarang: item.item_name,
        jumlah: item.quantity,
        kdSatuan: item.uom,
        nilai: item.value_amount,
        dokumen: [],
      })),
    }));

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.ADJUSTMENT,
          dokumenKegiatan,
        },
      ],
    };
  }

  static validateINSWPayload(payload: INSWTransaksiPayload): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!payload.data || payload.data.length === 0) {
      errors.push('Data transaksi tidak boleh kosong');
      return { valid: false, errors };
    }

    payload.data.forEach((transaksi, tIdx) => {
      if (!transaksi.kdKegiatan) {
        errors.push(`Data[${tIdx}]: Kode kegiatan harus diisi`);
      }

      if (
        !transaksi.dokumenKegiatan ||
        transaksi.dokumenKegiatan.length === 0
      ) {
        errors.push(`Data[${tIdx}]: Dokumen kegiatan tidak boleh kosong`);
        return;
      }

      transaksi.dokumenKegiatan.forEach((dok, dIdx) => {
        if (!dok.nomorDokKegiatan) {
          errors.push(
            `Data[${tIdx}].dokumenKegiatan[${dIdx}]: Nomor dokumen kegiatan harus diisi`
          );
        }

        if (!dok.tanggalKegiatan) {
          errors.push(
            `Data[${tIdx}].dokumenKegiatan[${dIdx}]: Tanggal kegiatan harus diisi`
          );
        }

        if (!dok.namaEntitas) {
          errors.push(
            `Data[${tIdx}].dokumenKegiatan[${dIdx}]: Nama entitas harus diisi`
          );
        }

        if (!dok.barangTransaksi || dok.barangTransaksi.length === 0) {
          errors.push(
            `Data[${tIdx}].dokumenKegiatan[${dIdx}]: Barang transaksi tidak boleh kosong`
          );
          return;
        }

        dok.barangTransaksi.forEach((brg, bIdx) => {
          if (!brg.kdKategoriBarang) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Kode kategori barang harus diisi`
            );
          }

          if (!brg.kdBarang) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Kode barang harus diisi`
            );
          }

          if (!brg.uraianBarang) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Uraian barang harus diisi`
            );
          }

          if (brg.jumlah === undefined || brg.jumlah === null) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Jumlah harus diisi`
            );
          }

          if (!brg.kdSatuan) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Kode satuan harus diisi`
            );
          }

          if (brg.nilai === undefined || brg.nilai === null) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Nilai harus diisi (gunakan 0 jika tidak ada)`
            );
          }

          if (!brg.dokumen) {
            errors.push(
              `Data[${tIdx}].dokumenKegiatan[${dIdx}].barangTransaksi[${bIdx}]: Dokumen harus diisi (gunakan [] jika tidak ada)`
            );
          }
        });
      });
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
