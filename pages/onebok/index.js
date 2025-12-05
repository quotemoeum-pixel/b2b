import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function Home() {
  const [inventoryMoveFile, setInventoryMoveFile] = useState(null);
  const [outboundFiles, setOutboundFiles] = useState([]);
  const [step1Result, setStep1Result] = useState(null);
  const [step2Results, setStep2Results] = useState([]); // 파일별 결과 배열
  const [quantityWarnings, setQuantityWarnings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // 엑셀 파일 읽기 함수
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

  // 엑셀 날짜 포맷팅
  const formatExcelDate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    
    // 엑셀 날짜 숫자인 경우 변환
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    return String(value);
  };

  // 재고이동 파일 파싱
  const parseInventoryMoveFile = (data) => {
    const headers = data[0];
    const barcodeIdx = headers.indexOf('바코드');
    const outLocationIdx = headers.indexOf('반출로케이션');
    const inLocationIdx = headers.indexOf('반입로케이션');
    const expiryDateIdx = headers.indexOf('유통기한');
    const lotIdx = headers.indexOf('LOT');
    const qtyIdx = headers.indexOf('이동수량');

    const inventory = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const barcodeVal = row[barcodeIdx];
      
      // 유효하지 않은 행 스킵
      if (!barcodeVal || barcodeVal === 'NaN' || String(barcodeVal).trim() === '' || typeof barcodeVal === 'undefined') {
        continue;
      }

      const barcode = String(barcodeVal).trim();
      const quantity = parseInt(row[qtyIdx]) || 0;

      if (barcode && quantity > 0) {
        inventory.push({
          barcode,
          outLocation: row[outLocationIdx],
          inLocation: row[inLocationIdx],
          expiryDate: formatExcelDate(row[expiryDateIdx]),
          lot: row[lotIdx],
          quantity
        });
      }
    }
    return inventory;
  };

  // 반출전표 파일 파싱
  const parseOutboundFile = (data) => {
    // 첫 번째 행 확인 - '예정정보'가 있으면 헤더가 두 줄인 형식
    let headerRow = data[0];
    let dataStartRow = 1;
    
    if (headerRow.includes('예정정보')) {
      // 두 번째 행이 실제 헤더
      headerRow = data[1];
      dataStartRow = 2;
    }

    const erpSeqIdx = headerRow.indexOf('ERP요청순번');
    const barcodeIdx = headerRow.indexOf('바코드');
    const expectedQtyIdx = headerRow.indexOf('예정수량');

    if (erpSeqIdx === -1 || barcodeIdx === -1 || expectedQtyIdx === -1) {
      throw new Error('반출전표 파일에 필수 컬럼(ERP요청순번, 바코드, 예정수량)이 없습니다.');
    }

    const outbounds = [];
    for (let i = dataStartRow; i < data.length; i++) {
      const row = data[i];
      const erpSeqVal = row[erpSeqIdx];
      
      // 유효하지 않은 행 스킵
      if (!erpSeqVal || erpSeqVal === 'NaN' || String(erpSeqVal).trim() === '' || typeof erpSeqVal === 'undefined') {
        continue;
      }

      const erpSeq = String(parseInt(erpSeqVal));
      const barcode = String(row[barcodeIdx]).trim();
      const expectedQty = parseInt(row[expectedQtyIdx]) || 0;

      if (erpSeq && barcode && expectedQty > 0) {
        outbounds.push({
          erpSeq,
          barcode,
          expectedQty,
          allocatedQty: 0
        });
      }
    }
    return outbounds;
  };

  // 수량 배정 알고리즘 (수량 추적 추가)
  const allocateInventory = (inventory, outbounds) => {
    const results = [];
    const inventoryMap = new Map();
    const warnings = {
      shortage: [],      // 재고 부족
      surplus: [],       // 재고 남음
      noInventory: []    // 재고 없음
    };

    // 재고를 바코드별로 그룹화
    inventory.forEach(item => {
      if (!inventoryMap.has(item.barcode)) {
        inventoryMap.set(item.barcode, []);
      }
      inventoryMap.get(item.barcode).push({ ...item, remainingQty: item.quantity });
    });

    // 반출전표별로 재고 할당
    outbounds.forEach(outbound => {
      const inventoryList = inventoryMap.get(outbound.barcode);
      
      if (!inventoryList || inventoryList.length === 0) {
        warnings.noInventory.push({
          barcode: outbound.barcode,
          erpSeq: outbound.erpSeq,
          expectedQty: outbound.expectedQty
        });
        return;
      }

      let remainingExpected = outbound.expectedQty;

      // FIFO 방식으로 재고 할당 (유통기한 빠른 순)
      inventoryList.sort((a, b) => {
        const dateA = new Date(a.expiryDate);
        const dateB = new Date(b.expiryDate);
        return dateA - dateB;
      });

      for (let inv of inventoryList) {
        if (remainingExpected <= 0) break;
        if (inv.remainingQty <= 0) continue;

        const allocatedQty = Math.min(inv.remainingQty, remainingExpected);
        
        results.push({
          barcode: outbound.barcode,
          erpSeq: outbound.erpSeq,
          normalMultiLocation: inv.outLocation,
          expiryDate: inv.expiryDate,
          lot: inv.lot,
          normalQty: allocatedQty
        });

        inv.remainingQty -= allocatedQty;
        remainingExpected -= allocatedQty;
      }

      if (remainingExpected > 0) {
        warnings.shortage.push({
          barcode: outbound.barcode,
          erpSeq: outbound.erpSeq,
          expectedQty: outbound.expectedQty,
          shortageQty: remainingExpected
        });
      }
    });

    // 남은 재고 확인
    inventoryMap.forEach((invList, barcode) => {
      const totalRemaining = invList.reduce((sum, inv) => sum + inv.remainingQty, 0);
      if (totalRemaining > 0) {
        warnings.surplus.push({
          barcode,
          surplusQty: totalRemaining,
          details: invList.filter(inv => inv.remainingQty > 0).map(inv => ({
            location: inv.outLocation,
            expiryDate: inv.expiryDate,
            lot: inv.lot,
            quantity: inv.remainingQty
          }))
        });
      }
    });

    return { results, warnings };
  };

  // 모든 파일 한번에 처리
  const handleProcessAll = async () => {
    if (!inventoryMoveFile) {
      setError('재고이동 관리 파일을 업로드해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    setStep1Result(null);
    setStep2Results([]);
    setQuantityWarnings(null);

    try {
      // 재고이동 파일 읽기
      const inventoryData = await readExcelFile(inventoryMoveFile);
      const inventory = parseInventoryMoveFile(inventoryData);

      if (inventory.length === 0) {
        throw new Error('재고이동 관리 파일에서 유효한 데이터를 찾을 수 없습니다.');
      }

      // 1단계 결과: 창고이동용 데이터
      const step1Data = inventory.map(item => ({
        barcode: item.barcode,
        outLocation: item.outLocation,
        inLocation: item.inLocation,
        expiryDate: item.expiryDate,
        lot: item.lot,
        quantity: item.quantity
      }));
      setStep1Result(step1Data);

      // 반출전표 파일이 있으면 2단계도 실행 (파일별로 처리)
      if (outboundFiles.length > 0) {
        const allStep2Results = [];
        const allWarnings = {
          shortage: [],
          surplus: [],
          noInventory: []
        };

        for (const file of outboundFiles) {
          const outboundData = await readExcelFile(file);
          const outbounds = parseOutboundFile(outboundData);

          if (outbounds.length === 0) {
            throw new Error(`${file.name} 파일에서 유효한 데이터를 찾을 수 없습니다.`);
          }

          // 각 파일마다 별도로 재고 배정
          const { results, warnings } = allocateInventory(inventory, outbounds);

          allStep2Results.push({
            fileName: file.name,
            results: results
          });

          // 경고 누적
          allWarnings.shortage.push(...warnings.shortage);
          allWarnings.surplus.push(...warnings.surplus);
          allWarnings.noInventory.push(...warnings.noInventory);
        }

        setStep2Results(allStep2Results);
        setQuantityWarnings(allWarnings);
      }
    } catch (err) {
      setError(`처리 중 오류 발생: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 1단계 엑셀 다운로드
  const handleStep1Download = () => {
    if (!step1Result || step1Result.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(step1Result, {
      header: ['barcode', 'outLocation', 'inLocation', 'expiryDate', 'lot', 'quantity']
    });

    XLSX.utils.sheet_add_aoa(ws, [['바코드', '반출로케이션', '반입로케이션', '유통기한', 'LOT', '이동수량']], { origin: 'A1' });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '재고이동');
    XLSX.writeFile(wb, `재고이동_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // 1단계 클립보드 복사
  const handleStep1Copy = () => {
    if (!step1Result || step1Result.length === 0) return;

    const csvContent = step1Result.map(row => 
      `${row.barcode}\t${row.outLocation}\t${row.inLocation}\t${row.expiryDate}\t${row.lot}\t${row.quantity}`
    ).join('\n');

    navigator.clipboard.writeText(csvContent).then(() => {
      alert('클립보드에 복사되었습니다. ERP에 붙여넣기 하세요.');
    }).catch(err => {
      alert('복사 실패: ' + err.message);
    });
  };

  // 2단계 엑셀 다운로드 (파일별)
  const handleStep2Download = (fileName, results) => {
    if (!results || results.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(results, {
      header: ['barcode', 'erpSeq', 'normalMultiLocation', 'expiryDate', 'lot', 'normalQty']
    });

    XLSX.utils.sheet_add_aoa(ws, [['바코드', 'ERP요청순번', '정상다중로케이션', '유통기한', 'LOT', '정상수량']], { origin: 'A1' });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '배정결과');
    XLSX.writeFile(wb, `${fileName.replace('.xlsx', '')}_배정결과_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // 2단계 클립보드 복사 (파일별)
  const handleStep2Copy = (results) => {
    if (!results || results.length === 0) return;

    const csvContent = results.map(row => 
      `${row.barcode}\t${row.erpSeq}\t${row.normalMultiLocation}\t${row.expiryDate}\t${row.lot}\t${row.normalQty}`
    ).join('\n');

    navigator.clipboard.writeText(csvContent).then(() => {
      alert('클립보드에 복사되었습니다. ERP에 붙여넣기 하세요.');
    }).catch(err => {
      alert('복사 실패: ' + err.message);
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">재고 배정 시스템</h1>
        <p className="text-gray-600">대기창고 재고 이동 및 반출전표 배정을 한번에 처리합니다</p>
      </div>

      {/* 파일 업로드 섹션 */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* 재고이동 파일 */}
        <div className="bg-white border-2 border-gray-200 rounded-lg p-6 hover:border-blue-400 transition-colors">
          <div className="flex items-center mb-4">
            <div className="bg-blue-100 p-2 rounded-lg mr-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">재고이동 관리 파일</h2>
            <span className="ml-auto bg-red-100 text-red-800 text-xs font-semibold px-2 py-1 rounded">필수</span>
          </div>
          <input
            type="file"
            accept=".xls,.xlsx"
            onChange={(e) => setInventoryMoveFile(e.target.files[0])}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
          {inventoryMoveFile && (
            <p className="mt-3 text-sm text-green-600 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {inventoryMoveFile.name}
            </p>
          )}
        </div>

        {/* 반출전표 파일 */}
        <div className="bg-white border-2 border-gray-200 rounded-lg p-6 hover:border-green-400 transition-colors">
          <div className="flex items-center mb-4">
            <div className="bg-green-100 p-2 rounded-lg mr-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">반출전표 파일</h2>
            <span className="ml-auto bg-gray-100 text-gray-800 text-xs font-semibold px-2 py-1 rounded">선택</span>
          </div>
          <input
            type="file"
            accept=".xls,.xlsx"
            multiple
            onChange={(e) => setOutboundFiles(Array.from(e.target.files))}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer"
          />
          {outboundFiles.length > 0 && (
            <div className="mt-3 space-y-1">
              {outboundFiles.map((file, idx) => (
                <p key={idx} className="text-sm text-green-600 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {file.name}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 실행 버튼 */}
      <div className="mb-8">
        <button
          onClick={handleProcessAll}
          disabled={loading || !inventoryMoveFile}
          className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-all ${
            loading || !inventoryMoveFile
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-green-600 text-white hover:from-blue-700 hover:to-green-700 shadow-lg hover:shadow-xl'
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              처리 중...
            </span>
          ) : (
            '🚀 전체 처리 실행'
          )}
        </button>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded">
          <div className="flex">
            <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-red-800">오류 발생</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* 수량 경고 */}
      {quantityWarnings && (quantityWarnings.shortage.length > 0 || quantityWarnings.surplus.length > 0 || quantityWarnings.noInventory.length > 0) && (
        <div className="mb-6 space-y-4">
          {/* 재고 없음 경고 */}
          {quantityWarnings.noInventory.length > 0 && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-red-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold text-red-800 mb-2">⚠️ 재고 없음 ({quantityWarnings.noInventory.length}건)</p>
                  <div className="space-y-1 text-sm text-red-700">
                    {quantityWarnings.noInventory.map((item, idx) => (
                      <div key={idx} className="bg-white p-2 rounded">
                        바코드: <span className="font-mono font-semibold">{item.barcode}</span> | 
                        ERP순번: <span className="font-semibold">{item.erpSeq}</span> | 
                        필요수량: <span className="font-semibold">{item.expectedQty}개</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 재고 부족 경고 */}
          {quantityWarnings.shortage.length > 0 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold text-yellow-800 mb-2">⚠️ 재고 부족 ({quantityWarnings.shortage.length}건)</p>
                  <div className="space-y-1 text-sm text-yellow-700">
                    {quantityWarnings.shortage.map((item, idx) => (
                      <div key={idx} className="bg-white p-2 rounded">
                        바코드: <span className="font-mono font-semibold">{item.barcode}</span> | 
                        ERP순번: <span className="font-semibold">{item.erpSeq}</span> | 
                        필요: <span className="font-semibold">{item.expectedQty}개</span> | 
                        부족: <span className="font-semibold text-red-600">{item.shortageQty}개</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 남은 재고 안내 */}
          {quantityWarnings.surplus.length > 0 && (
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold text-blue-800 mb-2">ℹ️ 남은 재고 ({quantityWarnings.surplus.length}건)</p>
                  <div className="space-y-2 text-sm text-blue-700">
                    {quantityWarnings.surplus.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded">
                        <div className="font-semibold mb-2">
                          바코드: <span className="font-mono">{item.barcode}</span> | 
                          남은 수량: <span className="text-blue-600">{item.surplusQty}개</span>
                        </div>
                        <div className="pl-4 space-y-1 text-xs">
                          {item.details.map((detail, didx) => (
                            <div key={didx} className="text-gray-600">
                              • {detail.location} | {detail.expiryDate} | LOT: {detail.lot} | {detail.quantity}개
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1단계 결과 */}
      {step1Result && step1Result.length > 0 && (
        <div className="mb-8 bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-blue-900 flex items-center">
              <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm">1</span>
              재고이동 데이터 ({step1Result.length}건)
            </h3>
            <div className="space-x-2">
              <button
                onClick={handleStep1Copy}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                📋 복사
              </button>
              <button
                onClick={handleStep1Download}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                📥 다운로드
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg overflow-hidden shadow">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">바코드</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">반출로케이션</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">반입로케이션</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">유통기한</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">LOT</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">이동수량</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {step1Result.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{row.barcode}</td>
                      <td className="px-4 py-3">{row.outLocation}</td>
                      <td className="px-4 py-3">{row.inLocation}</td>
                      <td className="px-4 py-3">{row.expiryDate}</td>
                      <td className="px-4 py-3">{row.lot}</td>
                      <td className="px-4 py-3 text-right font-semibold">{row.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 bg-blue-100 border border-blue-300 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              💡 <strong>다음 단계:</strong> 위 데이터를 복사하여 ERP에 입력하고 창고이동을 완료하세요.
            </p>
          </div>
        </div>
      )}

      {/* 2단계 결과 (파일별로 표시) */}
      {step2Results && step2Results.length > 0 && (
        <div className="space-y-6">
          {step2Results.map((fileResult, fileIdx) => (
            <div key={fileIdx} className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-green-900 flex items-center">
                  <span className="bg-green-600 text-white rounded-full w-8 h-8 flex items-center justify-center mr-3 text-sm">2</span>
                  {fileResult.fileName} - 배정 결과 ({fileResult.results.length}건)
                </h3>
                <div className="space-x-2">
                  <button
                    onClick={() => handleStep2Copy(fileResult.results)}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  >
                    📋 복사
                  </button>
                  <button
                    onClick={() => handleStep2Download(fileResult.fileName, fileResult.results)}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  >
                    📥 다운로드
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-lg overflow-hidden shadow">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b-2 border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">바코드</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">ERP요청순번</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">정상다중로케이션</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">유통기한</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">LOT</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-700">정상수량</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {fileResult.results.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs">{row.barcode}</td>
                          <td className="px-4 py-3">{row.erpSeq}</td>
                          <td className="px-4 py-3">{row.normalMultiLocation}</td>
                          <td className="px-4 py-3">{row.expiryDate}</td>
                          <td className="px-4 py-3">{row.lot}</td>
                          <td className="px-4 py-3 text-right font-semibold">{row.normalQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 bg-green-100 border border-green-300 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  ✅ <strong>배정 완료:</strong> 위 데이터를 사용하여 반출전표를 처리하세요.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}