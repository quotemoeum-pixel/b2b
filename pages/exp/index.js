import { useState } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import Head from 'next/head';
import AuthLayout from '@/components/AuthLayout';

export default function ExpiryMove() {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [daysThreshold, setDaysThreshold] = useState(0); // 0: 오늘 기준 경과, 양수: N일 이내 남은 것 포함

  const readExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          resolve(jsonData);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  };

  const parseExcelDate = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed;
      return null;
    }
    if (typeof value === 'number') {
      return new Date((value - 25569) * 86400 * 1000);
    }
    return null;
  };

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTodayString = () => formatDate(new Date());

  // daysThreshold: 0이면 오늘 기준 경과된 것, N이면 N일 남은 것까지 포함
  const isExpiredOrNearExpiry = (expiryDate, threshold) => {
    if (!expiryDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = parseExcelDate(expiryDate);
    if (!expiry) return false;
    expiry.setHours(0, 0, 0, 0);
    // 유통기한까지 남은 일수 (음수면 이미 경과)
    const remainingDays = (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    // threshold일 이내면 true (예: threshold=5면 5일 남은 것까지 포함)
    return remainingDays <= threshold;
  };

  const handleProcess = async () => {
    if (!file) {
      setError('재고현황 파일을 업로드해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setReportData(null);

    try {
      const data = await readExcelFile(file);
      if (data.length < 3) throw new Error('파일에 데이터가 충분하지 않습니다.');

      const headers = data[1];
      const findColumnIndex = (names) => {
        for (const name of names) {
          const idx = headers.findIndex(h => h && h.toString().trim() === name);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const barcodeIdx = findColumnIndex(['바코드']);
      const locationIdx = findColumnIndex(['다중로케이션']);
      const expiryIdx = findColumnIndex(['유통기한']);
      const lotIdx = findColumnIndex(['LOT']);
      const qtyIdx = findColumnIndex(['가용재고']);
      const warehouseIdx = findColumnIndex(['창고']);
      const productCodeIdx = findColumnIndex(['상품코드']);
      const productNameIdx = findColumnIndex(['상품명']);

      if (barcodeIdx === -1) throw new Error('바코드 컬럼을 찾을 수 없습니다.');
      if (locationIdx === -1) throw new Error('다중로케이션 컬럼을 찾을 수 없습니다.');
      if (expiryIdx === -1) throw new Error('유통기한 컬럼을 찾을 수 없습니다.');
      if (lotIdx === -1) throw new Error('LOT 컬럼을 찾을 수 없습니다.');
      if (qtyIdx === -1) throw new Error('가용재고 컬럼을 찾을 수 없습니다.');
      if (warehouseIdx === -1) throw new Error('창고 컬럼을 찾을 수 없습니다.');

      const expiredItems = [];
      for (let i = 2; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        const expiryDate = row[expiryIdx];
        const qty = parseFloat(row[qtyIdx]) || 0;

        if (isExpiredOrNearExpiry(expiryDate, daysThreshold) && qty > 0) {
          const parsedExpiry = parseExcelDate(expiryDate);
          expiredItems.push({
            barcode: row[barcodeIdx] ? String(row[barcodeIdx]).trim() : '',
            location: row[locationIdx] ? String(row[locationIdx]).trim() : '',
            expiryDate: formatDate(parsedExpiry),
            lot: row[lotIdx] ? String(row[lotIdx]).trim() : '',
            qty: qty,
            warehouse: row[warehouseIdx] ? String(row[warehouseIdx]).trim() : '',
            productCode: productCodeIdx !== -1 && row[productCodeIdx] ? String(row[productCodeIdx]).trim() : '',
            productName: productNameIdx !== -1 && row[productNameIdx] ? String(row[productNameIdx]).trim() : ''
          });
        }
      }

      if (expiredItems.length === 0) {
        const msg = daysThreshold > 0
          ? `유통기한 ${daysThreshold}일 이내 남은 재고가 없습니다.`
          : '유통기한 경과된 재고가 없습니다.';
        setError(msg);
        setLoading(false);
        return;
      }

      // 창고별 그룹화
      const warehouseGroups = {};
      expiredItems.forEach(item => {
        const wh = item.warehouse || '(창고없음)';
        if (!warehouseGroups[wh]) warehouseGroups[wh] = [];
        warehouseGroups[wh].push(item);
      });

      // 창고이동용 데이터
      const moveData = {};
      Object.keys(warehouseGroups).sort().forEach(wh => {
        moveData[wh] = warehouseGroups[wh].map(item => ({
          barcode: item.barcode,
          fromLocation: item.location,
          toLocation: item.location,
          expiryDate: item.expiryDate,
          lot: item.lot,
          qty: item.qty
        }));
      });

      // 보고용 데이터
      const today = getTodayString();
      const report = [];
      Object.keys(warehouseGroups).sort().forEach(wh => {
        warehouseGroups[wh].forEach(item => {
          report.push({
            date: today,
            fromWarehouse: wh,
            toWarehouse: `${wh} 경과`,
            productCode: item.productCode,
            productName: item.productName,
            barcode: item.barcode,
            expiryDate: item.expiryDate,
            lot: item.lot,
            qty: item.qty
          });
        });
      });

      setResults(moveData);
      setReportData(report);
    } catch (err) {
      setError(`오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 창고별 복사
  const handleCopyMove = (warehouseName, items) => {
    const content = items.map(row =>
      `${row.barcode}\t${row.fromLocation}\t${row.toLocation}\t${row.expiryDate}\t${row.lot}\t${row.qty}`
    ).join('\n');
    navigator.clipboard.writeText(content).then(() => {
      alert(`${warehouseName} 복사완료`);
    });
  };

  // 보고용 엑셀 다운로드
  const handleDownloadReport = async () => {
    if (!reportData || reportData.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const headers = ['일자', '반출창고', '반입창고', '상품코드', '상품명', '바코드', '유통기한', 'LOT', '이동수량'];
    const columnWidths = [12, 15, 15, 15, 30, 15, 12, 15, 12];

    const headerStyle = {
      font: { bold: true },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } },
      border: { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } },
      alignment: { horizontal: 'center', vertical: 'middle' }
    };
    const cellBorder = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    // 창고별 그룹화
    const warehouseData = {};
    reportData.forEach(row => {
      const wh = row.fromWarehouse;
      if (!warehouseData[wh]) warehouseData[wh] = [];
      warehouseData[wh].push(row);
    });

    // 전체 시트
    const allSheet = workbook.addWorksheet('전체');
    allSheet.addRow(headers);
    allSheet.getRow(1).eachCell((cell) => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.border = headerStyle.border;
      cell.alignment = headerStyle.alignment;
    });
    reportData.forEach(row => {
      const dataRow = allSheet.addRow([row.date, row.fromWarehouse, row.toWarehouse, row.productCode, row.productName, row.barcode, row.expiryDate, row.lot, row.qty]);
      dataRow.eachCell((cell) => { cell.border = cellBorder; });
    });
    allSheet.columns.forEach((col, idx) => { col.width = columnWidths[idx]; });

    // 창고별 시트
    Object.keys(warehouseData).sort().forEach(wh => {
      const sheetName = wh.length > 31 ? wh.substring(0, 31) : wh;
      const sheet = workbook.addWorksheet(sheetName);
      sheet.addRow(headers);
      sheet.getRow(1).eachCell((cell) => {
        cell.font = headerStyle.font;
        cell.fill = headerStyle.fill;
        cell.border = headerStyle.border;
        cell.alignment = headerStyle.alignment;
      });
      warehouseData[wh].forEach(row => {
        const dataRow = sheet.addRow([row.date, row.fromWarehouse, row.toWarehouse, row.productCode, row.productName, row.barcode, row.expiryDate, row.lot, row.qty]);
        dataRow.eachCell((cell) => { cell.border = cellBorder; });
      });
      sheet.columns.forEach((col, idx) => { col.width = columnWidths[idx]; });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `유통기한경과_보고_${getTodayString()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AuthLayout>
      <Head>
        <title>유통기한 경과</title>
      </Head>
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">유통기한 경과 창고이동</h1>

        {/* 파일 업로드 & 기준일 설정 */}
        <div className="bg-white border rounded p-4 mb-4 space-y-3">
          <div>
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => setFile(e.target.files[0])}
              className="text-sm"
            />
            {file && <span className="ml-2 text-sm text-green-600">{file.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">기준일:</label>
            <input
              type="number"
              value={daysThreshold}
              onChange={(e) => setDaysThreshold(parseInt(e.target.value) || 0)}
              className="w-20 px-2 py-1 border rounded text-center"
              min="0"
            />
            <span className="text-sm text-gray-500">
              {daysThreshold > 0
                ? `(${daysThreshold}일 남은 것까지 포함)`
                : '(오늘 기준 경과된 것만)'}
            </span>
          </div>
        </div>

        {/* 실행 버튼 */}
        <button
          onClick={handleProcess}
          disabled={loading || !file}
          className={`w-full py-2 rounded font-medium mb-4 ${
            loading || !file ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {loading ? '처리 중...' : '추출'}
        </button>

        {/* 에러 */}
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}

        {/* 결과 */}
        {results && (
          <div className="space-y-4">
            {/* 보고용 다운로드 */}
            <button
              onClick={handleDownloadReport}
              className="w-full py-2 rounded font-medium bg-purple-600 text-white hover:bg-purple-700"
            >
              보고용 엑셀 다운로드
            </button>

            {/* 창고별 */}
            {Object.keys(results).sort().map((wh) => (
              <div key={wh} className="border rounded p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">
                    {wh} → {wh} 경과 ({results[wh].length}건, {results[wh].reduce((s, r) => s + r.qty, 0)}개)
                  </span>
                  <button
                    onClick={() => handleCopyMove(wh, results[wh])}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    복사
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">바코드</th>
                      <th className="px-2 py-1 text-left">로케이션</th>
                      <th className="px-2 py-1 text-left">유통기한</th>
                      <th className="px-2 py-1 text-left">LOT</th>
                      <th className="px-2 py-1 text-right">수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results[wh].slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1 font-mono text-xs">{row.barcode}</td>
                        <td className="px-2 py-1">{row.fromLocation}</td>
                        <td className="px-2 py-1 text-red-600">{row.expiryDate}</td>
                        <td className="px-2 py-1">{row.lot}</td>
                        <td className="px-2 py-1 text-right">{row.qty}</td>
                      </tr>
                    ))}
                    {results[wh].length > 10 && (
                      <tr className="border-t">
                        <td colSpan={5} className="px-2 py-1 text-center text-gray-500">
                          ...외 {results[wh].length - 10}건
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
