import { format } from 'date-fns';
import { prisma } from '@/lib/prisma';
import {
  INSWApiHeaders,
  INSWTransaksiPayload,
  INSWSaldoAwalPayload,
  INSWBarangTransaksi,
  INSWDokumenKegiatan,
  INSWBarangSaldo,
  INSWActivityCode,
  INSW_ENDPOINTS,
  ITEM_TYPE_TO_INSW_CATEGORY,
  INSWApiResponse,
  INSWTransaksiResponse,
  INSWGetDataParams,
} from '@/lib/types/insw-api.types';
import {
  INSWIntegrationRepository,
  LaporanPemasukanView,
  LaporanPengeluaranView,
  BeginningBalanceData,
  ScrapTransactionData,
  MaterialUsageData,
  ProductionOutputData,
} from '@/lib/repositories/insw-integration.repository';

export class INSWIntegrationService {
  private repository: INSWIntegrationRepository;
  private apiHeaders: INSWApiHeaders;
  private useTestMode: boolean;

  constructor(
    apiKey: string,
    uniqueKey: string,
    useTestMode: boolean = true
  ) {
    this.repository = new INSWIntegrationRepository();
    this.apiHeaders = {
      'x-insw-key': apiKey,
      'x-unique-key': uniqueKey,
    };
    this.useTestMode = useTestMode;
  }

  private formatINSWDate(date: Date): string {
    return format(date, 'dd-MM-yyyy HH:mm:ss.SSS');
  }

  private formatINSWDateOnly(date: Date): string {
    return format(date, 'dd-MM-yyyy');
  }

  private mapItemTypeToINSWCategory(itemType: string): string {
    return ITEM_TYPE_TO_INSW_CATEGORY[itemType] || '1';
  }

  private async loadUomMappings(): Promise<Map<string, string>> {
    const mappings = await prisma.insw_uom_mapping.findMany({ where: { is_active: true } });
    return new Map(mappings.map((m) => [m.wms_uom.toUpperCase(), m.insw_uom]));
  }

  private mapCustomsDocTypeToINSWDocCode(
    customsDocType: string
  ): string | null {
    const mapping: Record<string, string> = {
      BC23: '0407023',
      BC27: '0407027',
      BC40: '0407040',
      BC30: '0407030',
      BC25: '0407025',
      BC41: '0407041',
      BC261: '0407261',
      BC262: '0407262',
      PPKEKTLDDP: '0407613',
      PPKEKLDIN: '0407611',
      PPKEKLDPOUT: '0407631',
    };

    return mapping[customsDocType] || null;
  }

  async convertPemasukanToINSW(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getLaporanPemasukanByIds(
      companyCode,
      ids
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PEMASUKAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupPemasukanByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.doc_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.doc_date),
        namaEntitas: group.shipper_name || 'Unknown',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.type_code),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.quantity),
          kdSatuan: (() => {
            const key = (item.unit || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.value_amount || 0),
          dokumen: [
            {
              kodeDokumen:
                this.mapCustomsDocTypeToINSWDocCode(
                  item.customs_document_type
                ) || '0407020',
              nomorDokumen: item.cust_doc_registration_no || item.doc_number,
              tanggalDokumen: this.formatINSWDateOnly(
                item.reg_date || item.doc_date
              ),
            },
          ],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PEMASUKAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertPengeluaranToINSWByIds(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getLaporanPengeluaranByIds(
      companyCode,
      ids
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PENGELUARAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupPengeluaranByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.doc_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.doc_date),
        namaEntitas: group.recipient_name || 'Unknown',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.type_code),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.quantity),
          kdSatuan: (() => {
            const key = (item.unit || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.value_amount || 0),
          dokumen: [
            {
              kodeDokumen:
                this.mapCustomsDocTypeToINSWDocCode(
                  item.customs_document_type
                ) || '0407631',
              nomorDokumen: item.cust_doc_registration_no || item.doc_number,
              tanggalDokumen: this.formatINSWDateOnly(
                item.reg_date || item.doc_date
              ),
            },
          ],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PENGELUARAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertPengeluaranToINSWByWmsIds(
    companyCode: number,
    wmsIds: string[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getLaporanPengeluaranByWmsIds(
      companyCode,
      wmsIds
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PENGELUARAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupPengeluaranByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.doc_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.doc_date),
        namaEntitas: group.recipient_name || 'Unknown',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.type_code),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.quantity),
          kdSatuan: (() => {
            const key = (item.unit || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.value_amount || 0),
          dokumen: [
            {
              kodeDokumen:
                this.mapCustomsDocTypeToINSWDocCode(
                  item.customs_document_type
                ) || '0407631',
              nomorDokumen: item.cust_doc_registration_no || item.doc_number,
              tanggalDokumen: this.formatINSWDateOnly(
                item.reg_date || item.doc_date
              ),
            },
          ],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PENGELUARAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertScrapInToINSW(
    companyCode: number,
    transactionIds: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getScrapTransactionByIds(
      companyCode,
      transactionIds
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PEMASUKAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupScrapTransactionsByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.document_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.transaction_date),
        namaEntitas: group.source || 'Scrap Collection',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.qty),
          kdSatuan: (() => {
            const key = (item.uom || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.amount || 0),
          dokumen: [],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PEMASUKAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertScrapOutToINSW(
    companyCode: number,
    transactionIds: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getScrapTransactionByIds(
      companyCode,
      transactionIds
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PENGELUARAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupScrapTransactionsByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.document_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.transaction_date),
        namaEntitas: group.recipient_name || 'Unknown',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.qty),
          kdSatuan: (() => {
            const key = (item.uom || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.amount || 0),
          dokumen: [
            {
              kodeDokumen:
                this.mapCustomsDocTypeToINSWDocCode(
                  item.customs_document_type || ''
                ) || '0407631',
              nomorDokumen: item.ppkek_number || group.document_number,
              tanggalDokumen: this.formatINSWDateOnly(
                item.customs_registration_date || group.transaction_date
              ),
            },
          ],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PENGELUARAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertCapitalGoodsOutToINSWByWmsIds(
    companyCode: number,
    wmsIds: string[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getLaporanPengeluaranByWmsIds(
      companyCode,
      wmsIds
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PENGELUARAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupPengeluaranByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.doc_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.doc_date),
        namaEntitas: group.recipient_name || 'Unknown',
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.type_code),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.quantity),
          kdSatuan: (() => {
            const key = (item.unit || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.value_amount || 0),
          dokumen: [
            {
              kodeDokumen:
                this.mapCustomsDocTypeToINSWDocCode(
                  item.customs_document_type
                ) || '0407631',
              nomorDokumen: item.cust_doc_registration_no || item.doc_number,
              tanggalDokumen: this.formatINSWDateOnly(
                item.reg_date || item.doc_date
              ),
            },
          ],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PENGELUARAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertSaldoAwalToINSW(
    companyCode: number,
    balanceDate?: Date
  ): Promise<INSWSaldoAwalPayload> {
    const data = await this.repository.getBeginningBalances(
      companyCode,
      balanceDate
    );

    const uomMap = await this.loadUomMappings();

    const effectiveDate = balanceDate || new Date();
    const barangSaldo: INSWBarangSaldo[] = data.map((item) => ({
      kd_kategori_barang: this.mapItemTypeToINSWCategory(item.item_type),
      kd_barang: item.item_code,
      uraian_barang: item.item_name,
      jumlah: Number(item.qty),
      satuan: uomMap.get(item.uom.toUpperCase()) || item.uom,
      nilai: 0,
      tanggal_declare: this.formatINSWDateOnly(item.balance_date),
    }));

    const docNumber = `${companyCode}/SAL/${format(effectiveDate, 'yyyy')}`;

    return {
      data: {
        no_kegiatan: docNumber,
        tgl_kegiatan: this.formatINSWDateOnly(effectiveDate),
        barangSaldo,
      },
    };
  }

  async convertMaterialUsageToINSW(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getMaterialUsageByIds(
      companyCode,
      ids
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PENGELUARAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupMaterialUsageByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.internal_evidence_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.transaction_date),
        namaEntitas: group.company_name,
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.qty),
          kdSatuan: (() => {
            const key = (item.uom || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.amount || 0),
          dokumen: [],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PENGELUARAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertProductionOutputToINSW(
    companyCode: number,
    ids: number[]
  ): Promise<INSWTransaksiPayload> {
    const data = await this.repository.getProductionOutputByIds(
      companyCode,
      ids
    );

    if (data.length === 0) {
      return {
        data: [
          {
            kdKegiatan: INSWActivityCode.PEMASUKAN,
            dokumenKegiatan: [],
          },
        ],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const groupedByDoc = this.groupProductionOutputByDocument(data);

    const dokumenKegiatan: INSWDokumenKegiatan[] = groupedByDoc.map(
      (group) => ({
        nomorDokKegiatan: group.internal_evidence_number,
        tanggalKegiatan: this.formatINSWDateOnly(group.transaction_date),
        namaEntitas: group.company_name,
        barangTransaksi: group.items.map((item) => ({
          kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
          kdBarang: item.item_code,
          uraianBarang: item.item_name,
          jumlah: Number(item.qty),
          kdSatuan: (() => {
            const key = (item.uom || '').toUpperCase();
            const mapped = uomMap.get(key) ?? null;
            if (!mapped) missingUoms.add(key);
            return mapped || key;
          })(),
          nilai: Number(item.amount || 0),
          dokumen: [],
        })),
      })
    );

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.PEMASUKAN,
          dokumenKegiatan,
        },
      ],
    };
  }

  async convertStockOpnameToINSW(
    companyCode: number,
    stockOpnameId: number
  ): Promise<INSWTransaksiPayload> {
    const opname = await prisma.wms_stock_opnames.findFirst({
      where: { id: BigInt(stockOpnameId), company_code: companyCode },
      include: { items: true },
    });

    if (!opname || opname.items.length === 0) {
      return {
        data: [{ kdKegiatan: INSWActivityCode.STOCK_OPNAME, dokumenKegiatan: [] }],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const barangTransaksi: INSWBarangTransaksi[] = opname.items.map((item) => {
      const uomKey = (item.uom || '').toUpperCase();
      const kdSatuan = uomMap.get(uomKey) ?? null;
      if (!kdSatuan) missingUoms.add(uomKey);
      return {
        kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
        kdBarang: item.item_code,
        uraianBarang: item.item_name,
        jumlah: Number(item.actual_qty_count),
        kdSatuan: kdSatuan || uomKey,
        nilai: Number(item.amount || 0),
        dokumen: [],
      };
    });

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.STOCK_OPNAME,
          dokumenKegiatan: [
            {
              nomorDokKegiatan: opname.wms_id,
              tanggalKegiatan: this.formatINSWDateOnly(opname.document_date),
              namaEntitas: String(opname.company_code),
              barangTransaksi,
            },
          ],
        },
      ],
    };
  }

  async convertAdjustmentToINSW(
    companyCode: number,
    adjustmentId: number
  ): Promise<INSWTransaksiPayload> {
    const adjustment = await prisma.adjustments.findFirst({
      where: { id: adjustmentId, company_code: companyCode, deleted_at: null },
      include: { items: { where: { deleted_at: null } } },
    });

    if (!adjustment || adjustment.items.length === 0) {
      return {
        data: [{ kdKegiatan: INSWActivityCode.ADJUSTMENT, dokumenKegiatan: [] }],
      };
    }

    const uomMap = await this.loadUomMappings();
    const missingUoms = new Set<string>();

    const barangTransaksi: INSWBarangTransaksi[] = adjustment.items.map((item) => {
      const uomKey = (item.uom || '').toUpperCase();
      const kdSatuan = uomMap.get(uomKey) ?? null;
      if (!kdSatuan) missingUoms.add(uomKey);
      const signedQty = item.adjustment_type === 'LOSS' ? -Number(item.qty) : Number(item.qty);
      return {
        kdKategoriBarang: this.mapItemTypeToINSWCategory(item.item_type),
        kdBarang: item.item_code,
        uraianBarang: item.item_name,
        jumlah: signedQty,
        keterangan: item.reason || '',
        kdSatuan: kdSatuan || uomKey,
        nilai: 0,
        dokumen: [],
      };
    });

    if (missingUoms.size > 0) {
      throw new Error(
        `UOM mapping tidak ditemukan untuk: ${Array.from(missingUoms).join(', ')}. ` +
        `Silakan tambahkan mapping di menu INSW > UOM Mapping terlebih dahulu.`
      );
    }

    return {
      data: [
        {
          kdKegiatan: INSWActivityCode.ADJUSTMENT,
          dokumenKegiatan: [
            {
              nomorDokKegiatan: adjustment.internal_evidence_number,
              tanggalKegiatan: this.formatINSWDateOnly(adjustment.transaction_date),
              namaEntitas: String(adjustment.company_code),
              barangTransaksi,
            },
          ],
        },
      ],
    };
  }

  private groupMaterialUsageByDocument(data: MaterialUsageData[]) {
    const grouped = new Map<number, MaterialUsageData[]>();

    data.forEach((item) => {
      // Group by transaction_id to ensure 1 WMS header = 1 INSW dokumenKegiatan
      const key = item.transaction_id;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });

    return Array.from(grouped.values()).map((items) => ({
      internal_evidence_number: items[0].internal_evidence_number,
      transaction_date: items[0].transaction_date,
      company_name: items[0].company_name,
      items,
    }));
  }

  private groupProductionOutputByDocument(data: ProductionOutputData[]) {
    const grouped = new Map<number, ProductionOutputData[]>();

    data.forEach((item) => {
      // Group by transaction_id to ensure 1 WMS header = 1 INSW dokumenKegiatan
      const key = item.transaction_id;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });

    return Array.from(grouped.values()).map((items) => ({
      internal_evidence_number: items[0].internal_evidence_number,
      transaction_date: items[0].transaction_date,
      company_name: items[0].company_name,
      items,
    }));
  }

  private groupScrapTransactionsByDocument(data: ScrapTransactionData[]) {
    const grouped = new Map<string, ScrapTransactionData[]>();

    data.forEach((item) => {
      const key = `${item.document_number}_${format(item.transaction_date, 'yyyy-MM-dd')}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });

    return Array.from(grouped.values()).map((items) => ({
      document_number: items[0].document_number,
      transaction_date: items[0].transaction_date,
      source: items[0].source,
      recipient_name: items[0].recipient_name,
      items,
    }));
  }

  private groupPemasukanByDocument(data: LaporanPemasukanView[]) {
    const grouped = new Map<string, LaporanPemasukanView[]>();

    data.forEach((item) => {
      const key = `${item.doc_number}_${format(item.doc_date, 'yyyy-MM-dd')}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });

    return Array.from(grouped.values()).map((items) => ({
      doc_number: items[0].doc_number,
      doc_date: items[0].doc_date,
      shipper_name: items[0].shipper_name,
      items,
    }));
  }

  private groupPengeluaranByDocument(data: LaporanPengeluaranView[]) {
    const grouped = new Map<string, LaporanPengeluaranView[]>();

    data.forEach((item) => {
      const key = `${item.doc_number}_${format(item.doc_date, 'yyyy-MM-dd')}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(item);
    });

    return Array.from(grouped.values()).map((items) => ({
      doc_number: items[0].doc_number,
      doc_date: items[0].doc_date,
      recipient_name: items[0].recipient_name,
      items,
    }));
  }

  async postSaldoAwal(
    payload: INSWSaldoAwalPayload
  ): Promise<INSWApiResponse> {
    const endpoint = this.useTestMode
      ? INSW_ENDPOINTS.saldoAwal.temp
      : INSW_ENDPOINTS.saldoAwal.real;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }

  async postPemasukan(
    payload: INSWTransaksiPayload
  ): Promise<INSWApiResponse> {
    const endpoint = this.useTestMode
      ? INSW_ENDPOINTS.transaksi.temp
      : INSW_ENDPOINTS.transaksi.real;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }

  async postPengeluaran(
    payload: INSWTransaksiPayload
  ): Promise<INSWApiResponse> {
    const endpoint = this.useTestMode
      ? INSW_ENDPOINTS.transaksi.temp
      : INSW_ENDPOINTS.transaksi.real;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }

  async postStockOpname(
    payload: INSWTransaksiPayload
  ): Promise<INSWApiResponse> {
    const endpoint = this.useTestMode
      ? INSW_ENDPOINTS.transaksi.temp
      : INSW_ENDPOINTS.transaksi.real;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }

  async postAdjustment(
    payload: INSWTransaksiPayload
  ): Promise<INSWApiResponse> {
    const endpoint = this.useTestMode
      ? INSW_ENDPOINTS.transaksi.temp
      : INSW_ENDPOINTS.transaksi.real;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
      body: JSON.stringify(payload),
    });

    return response.json();
  }

  async getPemasukan(
    params: INSWGetDataParams
  ): Promise<INSWApiResponse<INSWTransaksiResponse[]>> {
    const endpoint = this.useTestMode
      ? `${INSW_ENDPOINTS.transaksi.temp}/${INSWActivityCode.PEMASUKAN}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`
      : `${INSW_ENDPOINTS.transaksi.real}/${INSWActivityCode.PEMASUKAN}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }

  async getPengeluaran(
    params: INSWGetDataParams
  ): Promise<INSWApiResponse<INSWTransaksiResponse[]>> {
    const endpoint = this.useTestMode
      ? `${INSW_ENDPOINTS.transaksi.temp}/${INSWActivityCode.PENGELUARAN}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`
      : `${INSW_ENDPOINTS.transaksi.real}/${INSWActivityCode.PENGELUARAN}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }

  async getStockOpname(
    params: INSWGetDataParams
  ): Promise<INSWApiResponse<INSWTransaksiResponse[]>> {
    const endpoint = this.useTestMode
      ? `${INSW_ENDPOINTS.transaksi.temp}/${INSWActivityCode.STOCK_OPNAME}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`
      : `${INSW_ENDPOINTS.transaksi.real}/${INSWActivityCode.STOCK_OPNAME}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }

  async getAdjustment(
    params: INSWGetDataParams
  ): Promise<INSWApiResponse<INSWTransaksiResponse[]>> {
    const endpoint = this.useTestMode
      ? `${INSW_ENDPOINTS.transaksi.temp}/${INSWActivityCode.ADJUSTMENT}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`
      : `${INSW_ENDPOINTS.transaksi.real}/${INSWActivityCode.ADJUSTMENT}/tglAwal=${params.tglAwal}&tglAkhir=${params.tglAkhir}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }

  async cleansingData(npwp: string): Promise<INSWApiResponse> {
    if (!this.useTestMode) {
      throw new Error('Cleansing data only available in test mode');
    }

    const endpoint = `${INSW_ENDPOINTS.transaksi.temp}?npwp=${npwp}`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }

  async registrasiFinal(): Promise<INSWApiResponse> {
    if (!this.useTestMode) {
      throw new Error('Final registration only available in test mode');
    }

    const response = await fetch(INSW_ENDPOINTS.registrasi.temp, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
      },
    });

    return response.json();
  }
}
