import { useState } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import AuthLayout from '@/components/AuthLayout';

export default function Extract() {
  // 상태 변수들
  const [extractedData, setExtractedData] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [locationPrefix, setLocationPrefix] = useState('');
  const [showCopyMessage, setShowCopyMessage] = useState(false);

  // 엑셀 파일 업로드 처리
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
          range: 1, // 2행부터 시작 (0-indexed)
          defval: '' // 빈 셀에 대한 기본값
        });
        
        // 원본 데이터도 저장 (최대 10개) - 필요한 필드만 추출
        const originalDataSlice = jsonData.slice(0, 10).map(item => ({
          '상품코드': item['상품코드'] || '',
          '상품명': item['상품명'] || '',
          '바코드': item['바코드'] || '',
          'ERP요청순번': item['ERP요청순번'] || '',
          '정상다중로케이션': item['정상다중로케이션'] || '',
          '유통기한': item['유통기한'] || '',
          'LOT': item['LOT'] || '',
          '정상수량': item['정상수량'] || ''
        }));
        
        // 바코드가 있고 정상수량이 0이 아닌 행의 합계 계산
        // 합계 행 제외 (일반적으로 마지막 행이거나 바코드가 비어있고 '합계'라는 단어가 있는 행)
        const totalNormalQuantity = jsonData.reduce((sum, item) => {
          const quantity = parseFloat(item['정상수량'] || 0);
          const barcode = item['바코드'] || '';
          const productName = (item['상품명'] || '').toString().toLowerCase();
          
          // 합계 행 여부 확인 (바코드가 비어있고 상품명이나 다른 필드에 '합계'가 포함된 경우)
          const isSummaryRow = barcode.trim() === '' && (
            productName.includes('합계') || 
            productName.includes('total') ||
            (item['ERP요청순번'] || '').toString().includes('합계')
          );
          
          // 바코드가 있고, 정상수량이 0이 아니고, 합계 행이 아닌 경우만 합산
          return (barcode.trim() !== '' && quantity > 0 && !isSummaryRow) 
            ? sum + quantity 
            : sum;
        }, 0);
        
        // 정상수량이 0인 항목과 바코드가 비어있는 항목 제외
        // 또한 합계 행 제외
        const filteredData = jsonData
          .filter(item => {
            const normalQuantity = parseFloat(item['정상수량'] || 0);
            const barcode = item['바코드'] || '';
            const productName = (item['상품명'] || '').toString().toLowerCase();
            
            // 합계 행 여부 확인
            const isSummaryRow = barcode.trim() === '' && (
              productName.includes('합계') || 
              productName.includes('total') ||
              (item['ERP요청순번'] || '').toString().includes('합계')
            );
            
            return normalQuantity > 0 && barcode.trim() !== '' && !isSummaryRow;
          })
          .map(item => ({
            '바코드': item['바코드'] || '',
            'ERP요청순번': item['ERP요청순번'] || '',
            '정상다중로케이션': item['정상다중로케이션'] || '',
            '유통기한': item['유통기한'] || '',
            'LOT': item['LOT'] || '',
            '정상수량': item['정상수량'] || ''
          }));
        
        setExtractedData(filteredData);
        setOriginalData(originalDataSlice);
        setTotalQuantity(totalNormalQuantity);
      } catch (error) {
        console.error('파일 처리 중 오류 발생:', error);
        alert('파일 처리 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 로케이션 변경 모드 상태 추가
  const [locationMode, setLocationMode] = useState('prefix'); // 'prefix' or 'full'

  // 로케이션 접두사 변경 및 데이터 처리
  const processLocationPrefix = () => {
    if (!locationPrefix.trim() || !extractedData) return;

    const value = locationPrefix.trim();

    if (locationMode === 'prefix' && value.length !== 2) {
      alert('접두사 모드에서는 2자리로 입력해주세요.');
      return;
    }

    const processedData = extractedData.map(item => {
      const location = item['정상다중로케이션'];
      let newLocation;

      if (locationMode === 'prefix') {
        // 접두사 모드: 앞 2자리만 변경
        newLocation = location ? value + location.substring(2) : location;
      } else {
        // 전체 변경 모드: 모든 로케이션을 입력값으로 대체
        newLocation = value;
      }

      return {
        ...item,
        '정상다중로케이션': newLocation
      };
    });

    setExtractedData(processedData);
  };

  // 클립보드에 복사 (헤더 없이)
  const copyToClipboard = () => {
    if (!extractedData || extractedData.length === 0) return;

    // 필드 순서 정의
    const fields = ['바코드', 'ERP요청순번', '정상다중로케이션', '유통기한', 'LOT', '정상수량'];
    
    // 데이터 행만 추출 (헤더 없이)
    const rows = extractedData.map(item => 
      fields.map(field => item[field] || '').join('\t')
    );
    
    // 데이터만 텍스트로 변환 (헤더 제외)
    const text = rows.join('\n');
    
    // 클립보드에 복사
    navigator.clipboard.writeText(text)
      .then(() => {
        setShowCopyMessage(true);
        setTimeout(() => setShowCopyMessage(false), 2000);
      })
      .catch(err => {
        console.error('클립보드 복사 실패:', err);
        alert('클립보드 복사에 실패했습니다.');
      });
  };

  return (
    <AuthLayout>
      <Head>
        <title>B2C2</title>
      </Head>
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">엑셀 데이터 추출</h1>
      
      <div className="mb-6 p-4 border rounded">
        <h2 className="text-lg font-semibold mb-2">1. 엑셀 파일 업로드</h2>
        <p className="text-sm text-gray-600 mb-2">* 2행에 컬럼명이 있는 엑셀 파일을 업로드하세요.</p>
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {isLoading && (
          <p className="text-sm text-blue-600 mt-2">
            파일 처리 중...
          </p>
        )}
        {extractedData && (
          <div className="mt-2">
            <p className="text-sm text-green-600">
              {extractedData.length}개의 데이터가 추출되었습니다.
            </p>
            <p className="text-sm text-blue-600">
              유효한 데이터의 정상수량 합계: <span className="font-bold">{totalQuantity.toLocaleString()}</span>
            </p>
          </div>
        )}
      </div>
      
      {originalData && originalData.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">기존 데이터 (최대 10개)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border-collapse border">
              <thead>
                <tr className="bg-blue-100">
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">상품코드</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">상품명</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">바코드</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">ERP요청순번</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상다중로케이션</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">유통기한</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">LOT</th>
                  <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상수량</th>
                </tr>
              </thead>
              <tbody>
                {originalData.map((item, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['상품코드']}</td>
                    <td className="px-4 py-2 border border-gray-300">{item['상품명']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['바코드']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['ERP요청순번']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['정상다중로케이션']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['유통기한']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['LOT']}</td>
                    <td className="px-4 py-2 border border-gray-300 text-center">{item['정상수량']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {extractedData && extractedData.length > 0 && (
        <div className="mb-6 p-4 border rounded">
          <h2 className="text-lg font-semibold mb-2">2. 로케이션 변경</h2>
          <div className="flex items-center mb-3">
            <label className="mr-4 flex items-center">
              <input
                type="radio"
                name="locationMode"
                value="prefix"
                checked={locationMode === 'prefix'}
                onChange={(e) => setLocationMode(e.target.value)}
                className="mr-1"
              />
              접두사 변경 (앞 2자리만)
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="locationMode"
                value="full"
                checked={locationMode === 'full'}
                onChange={(e) => setLocationMode(e.target.value)}
                className="mr-1"
              />
              전체 변경
            </label>
          </div>
          <div className="flex items-center mb-4">
            <input
              type="text"
              value={locationPrefix}
              onChange={(e) => setLocationPrefix(e.target.value)}
              placeholder={locationMode === 'prefix' ? "접두사 2자리 입력 (예: CC)" : "새 로케이션 입력 (예: CC01-01-01)"}
              maxLength={locationMode === 'prefix' ? 2 : undefined}
              className="border p-2 mr-2 w-56"
            />
            <button
              onClick={processLocationPrefix}
              className="px-4 py-2 bg-blue-600 text-white rounded"
            >
              적용
            </button>
          </div>
          <p className="text-sm text-gray-600">
            {locationMode === 'prefix'
              ? '* 입력한 접두사로 모든 정상다중로케이션의 앞 2자리가 변경됩니다.'
              : '* 입력한 값으로 모든 정상다중로케이션이 완전히 대체됩니다.'}
          </p>
        </div>
      )}
      
      {extractedData && extractedData.length > 0 && (
        <div className="mb-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold">추출 결과 ({extractedData.length}개)</h2>
          <button
            onClick={copyToClipboard}
            className="px-4 py-2 bg-green-600 text-white rounded flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            클립보드에 복사
          </button>
        </div>
      )}
      
      {showCopyMessage && (
        <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          클립보드에 복사되었습니다!
        </div>
      )}
      
      {extractedData && extractedData.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border-collapse border">
            <thead>
              <tr className="bg-blue-100">
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">바코드</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">ERP요청순번</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상다중로케이션</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">유통기한</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">LOT</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상수량</th>
              </tr>
            </thead>
            <tbody>
              {extractedData.map((item, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['바코드']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['ERP요청순번']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center font-bold">{item['정상다중로케이션']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['유통기한']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['LOT']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['정상수량']}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </AuthLayout>
  );
}