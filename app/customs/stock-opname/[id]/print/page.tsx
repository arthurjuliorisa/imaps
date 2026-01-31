'use client';

import React, { useState, useEffect, use } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Divider, CircularProgress } from '@mui/material';
import { StockOpname, StockOpnameItem } from '@/types/stock-opname';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PrintStockOpnamePage({ params }: PageProps) {
  const resolvedParams = use(params);
  const stockOpnameId = parseInt(resolvedParams.id);

  const [loading, setLoading] = useState(true);
  const [stockOpname, setStockOpname] = useState<StockOpname | null>(null);
  const [items, setItems] = useState<StockOpnameItem[]>([]);
  const [companyName, setCompanyName] = useState<string>('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch stock opname data
        const response = await fetch(`/api/customs/stock-opname/${stockOpnameId}`);
        if (!response.ok) throw new Error('Failed to fetch stock opname');

        const data = await response.json();
        setStockOpname(data.stockOpname);
        setItems(data.items || []);

        // Fetch company name
        if (data.stockOpname) {
          const companyResponse = await fetch(`/api/master/companies?code=${data.stockOpname.company_code}`);
          if (companyResponse.ok) {
            const companyResult = await companyResponse.json();
            if (companyResult.success && companyResult.data && companyResult.data.length > 0) {
              setCompanyName(companyResult.data[0].name);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [stockOpnameId]);

  useEffect(() => {
    // Auto print when data is loaded
    if (!loading && stockOpname && items.length > 0) {
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [loading, stockOpname, items]);

  useEffect(() => {
    // Auto close after print dialog is closed
    const handleAfterPrint = () => {
      window.close();
    };

    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  const totals = items.reduce(
    (acc, item) => ({
      totalStoQty: acc.totalStoQty + Number(item.sto_qty || 0),
      totalEndStock: acc.totalEndStock + Number(item.end_stock || 0),
      totalVariant: acc.totalVariant + Number(item.variant || 0),
    }),
    { totalStoQty: 0, totalEndStock: 0, totalVariant: 0 }
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!stockOpname) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          Stock opname not found
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          body {
            margin: 0;
            padding: 0;
          }

          /* Hide navbar, sidebar, and other UI elements */
          header, nav, aside, .MuiDrawer-root, .MuiAppBar-root {
            display: none !important;
          }

          /* Ensure content takes full width */
          main {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
        }

        @page {
          size: A4 landscape;
          margin: 10mm;
        }
      `}</style>

      <Box
        sx={{
          p: 3,
          backgroundColor: 'white',
          '@media screen': {
            maxWidth: '297mm',
            margin: '0 auto',
          },
          '@media print': {
            p: 0,
            m: 0,
            maxWidth: '100%',
          },
        }}
      >
        {/* Header */}
        <Box sx={{ mb: 2, textAlign: 'center' }}>
          <Typography
            sx={{
              fontSize: '16pt',
              fontWeight: 'bold',
              mb: 0.5,
              '@media print': { fontSize: '14pt' }
            }}
          >
            LAPORAN STOCK OPNAME
          </Typography>
          <Typography
            sx={{
              fontSize: '12pt',
              '@media print': { fontSize: '10pt' }
            }}
          >
            {companyName}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
        </Box>

        {/* Document Info */}
        <Box sx={{ mb: 2 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ border: 'none', width: '25%', py: 0.3, fontSize: '9pt' }}>
                  <strong>Nomor STO</strong>
                </TableCell>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>: {stockOpname.sto_number}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>
                  <strong>Tanggal STO</strong>
                </TableCell>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>: {formatDate(stockOpname.sto_datetime)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>
                  <strong>Kode Perusahaan</strong>
                </TableCell>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>: {stockOpname.company_code}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>
                  <strong>PIC</strong>
                </TableCell>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>: {stockOpname.pic_name || '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>
                  <strong>Status</strong>
                </TableCell>
                <TableCell sx={{ border: 'none', py: 0.3, fontSize: '9pt' }}>: {stockOpname.status}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* Items Table - No Container, No Paper */}
        <Box sx={{ mb: 2, width: '100%', overflow: 'visible' }}>
          <Table
            size="small"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              '& th, & td': {
                fontSize: '8pt',
                padding: '4px',
                lineHeight: 1.3,
                '@media print': {
                  fontSize: '7.5pt',
                  padding: '3px',
                }
              }
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'center', width: '4%' }}>No</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', width: '30%' }}>Kode & Nama Item</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'center', width: '7%' }}>Tipe</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'center', width: '7%' }}>UOM</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right', width: '10%' }}>Qty STO</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right', width: '10%' }}>End Stock</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right', width: '10%' }}>Variance</TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', width: '22%' }}>Area & Keterangan</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'center' }}>{index + 1}</TableCell>
                  <TableCell sx={{ border: '1px solid black', wordBreak: 'break-word' }}>
                    <Box component="span" sx={{ fontWeight: 'bold', display: 'block' }}>{item.item_code}</Box>
                    <Box component="span">{item.item_name}</Box>
                  </TableCell>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'center' }}>{item.item_type}</TableCell>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'center' }}>{item.uom}</TableCell>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'right' }}>
                    {Number(item.sto_qty).toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'right' }}>
                    {Number(item.end_stock).toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid black', textAlign: 'right' }}>
                    {Number(item.variant).toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ border: '1px solid black', wordBreak: 'break-word' }}>
                    {item.report_area && (
                      <Box component="span" sx={{ fontWeight: 'bold', display: 'block' }}>{item.report_area}</Box>
                    )}
                    {item.remark && (
                      <Box component="span">{item.remark}</Box>
                    )}
                    {!item.report_area && !item.remark && '-'}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals Row */}
              <TableRow>
                <TableCell colSpan={4} sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right' }}>
                  TOTAL
                </TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right' }}>
                  {totals.totalStoQty.toFixed(2)}
                </TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right' }}>
                  {totals.totalEndStock.toFixed(2)}
                </TableCell>
                <TableCell sx={{ fontWeight: 'bold', border: '1px solid black', textAlign: 'right' }}>
                  {totals.totalVariant.toFixed(2)}
                </TableCell>
                <TableCell sx={{ border: '1px solid black' }} />
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* Signatures */}
        <Box
          sx={{
            mt: 3,
            display: 'flex',
            justifyContent: 'space-between',
            '@media print': { mt: 2 }
          }}
        >
          {/* Dibuat Oleh */}
          <Box sx={{ textAlign: 'center', width: '40%' }}>
            <Typography sx={{ fontSize: '9pt', fontWeight: 'bold', mb: 1 }}>
              Dibuat Oleh,
            </Typography>
            <Box sx={{ height: '60px', my: 1.5 }} />
            <Divider sx={{ width: '100%', borderBottom: '1px solid black' }} />
            <Typography sx={{ fontSize: '9pt', mt: 0.5 }}>
              {stockOpname.created_by || '(...............................)'}
            </Typography>
            <Typography sx={{ fontSize: '8pt', color: 'text.secondary' }}>
              Tanggal: {formatDateTime(stockOpname.created_at)}
            </Typography>
          </Box>

          {/* Disetujui Oleh */}
          <Box sx={{ textAlign: 'center', width: '40%' }}>
            <Typography sx={{ fontSize: '9pt', fontWeight: 'bold', mb: 1 }}>
              Disetujui Oleh,
            </Typography>
            <Box sx={{ height: '60px', my: 1.5 }} />
            <Divider sx={{ width: '100%', borderBottom: '1px solid black' }} />
            <Typography sx={{ fontSize: '9pt', mt: 0.5 }}>
              {stockOpname.pic_name || '(...............................)'}
            </Typography>
            <Typography sx={{ fontSize: '8pt', color: 'text.secondary' }}>
              Tanggal: ..............................
            </Typography>
          </Box>
        </Box>

        {/* Footer */}
        <Box
          sx={{
            mt: 3,
            pt: 1.5,
            borderTop: '1px solid #ddd',
            '@media print': { mt: 2, pt: 1 }
          }}
        >
          <Typography sx={{ fontSize: '8pt', color: 'text.secondary', textAlign: 'center' }}>
            Dicetak pada: {new Date().toLocaleDateString('en-US', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </Typography>
        </Box>
      </Box>
    </>
  );
}
