/**
 * Example Client Component for downloading the Scrap Import Template
 *
 * This is a reference implementation showing how to integrate the template
 * download functionality into a client-side component.
 *
 * USAGE:
 * Copy this component to your desired location (e.g., app/components/)
 * and import it into your page.
 *
 * Example:
 * import DownloadScrapTemplate from '@/components/DownloadScrapTemplate';
 *
 * // In your page or component:
 * <DownloadScrapTemplate />
 */

'use client';

import { useState } from 'react';
import { Button, CircularProgress, Alert, Snackbar } from '@mui/material';
import { Download } from '@mui/icons-material';

interface DownloadState {
  isLoading: boolean;
  error: string | null;
  success: boolean;
}

export default function DownloadScrapTemplate() {
  const [state, setState] = useState<DownloadState>({
    isLoading: false,
    error: null,
    success: false,
  });

  /**
   * Handles the template download process
   */
  const handleDownloadTemplate = async () => {
    setState({ isLoading: true, error: null, success: false });

    try {
      // Fetch the template from the API endpoint
      const response = await fetch('/api/customs/scrap/template', {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });

      // Check if the request was successful
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to download template');
      }

      // Get the blob data
      const blob = await response.blob();

      // Extract filename from Content-Disposition header if available
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'Scrap_Import_Template.xlsx';

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }

      // Create a temporary URL for the blob
      const url = window.URL.createObjectURL(blob);

      // Create a temporary anchor element and trigger download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Update state to show success
      setState({ isLoading: false, error: null, success: true });

    } catch (error) {
      console.error('Error downloading template:', error);
      setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
        success: false,
      });
    }
  };

  /**
   * Closes the success/error snackbar
   */
  const handleCloseSnackbar = () => {
    setState(prev => ({ ...prev, success: false, error: null }));
  };

  return (
    <>
      <Button
        variant="outlined"
        color="primary"
        startIcon={state.isLoading ? <CircularProgress size={20} /> : <Download />}
        onClick={handleDownloadTemplate}
        disabled={state.isLoading}
        sx={{
          textTransform: 'none',
          fontWeight: 500,
        }}
      >
        {state.isLoading ? 'Downloading...' : 'Download Import Template'}
      </Button>

      {/* Success Snackbar */}
      <Snackbar
        open={state.success}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
          Template downloaded successfully!
        </Alert>
      </Snackbar>

      {/* Error Snackbar */}
      <Snackbar
        open={!!state.error}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="error" sx={{ width: '100%' }}>
          {state.error || 'Failed to download template'}
        </Alert>
      </Snackbar>
    </>
  );
}

/**
 * Alternative: Inline usage without a separate component
 *
 * You can also use this function directly in your existing components:
 */
export async function downloadScrapTemplate(): Promise<void> {
  try {
    const response = await fetch('/api/customs/scrap/template');

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to download template');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Scrap_Import_Template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading template:', error);
    throw error;
  }
}

/**
 * Example usage in a page:
 *
 * import DownloadScrapTemplate, { downloadScrapTemplate } from '@/components/DownloadScrapTemplate';
 *
 * export default function ScrapImportPage() {
 *   return (
 *     <div>
 *       <h1>Scrap Import</h1>
 *       <p>Download the template to get started:</p>
 *       <DownloadScrapTemplate />
 *
 *       {/}* Or use the function directly *{/}
 *       <Button onClick={() => downloadScrapTemplate()}>
 *         Custom Download Button
 *       </Button>
 *     </div>
 *   );
 * }
 */
