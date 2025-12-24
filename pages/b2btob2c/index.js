import { useState } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function Home() {
  const [pickingData, setPickingData] = useState(null);
  const [inventoryData, setInventoryData] = useState(null);
  const [processedData, setProcessedData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // 피킹지 파일 업로드 처리
  const handlePickingUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

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
        
        setPickingData(jsonData);
      } catch (error) {
        console.error('피킹지 파일 처리 중 오류 발생:', error);
        alert('파일 처리 중 오류가 발생했습니다.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 재고 데이터 파일 업로드 처리
  const handleInventoryUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

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
        
        setInventoryData(jsonData);
      } catch (error) {
        console.error('재고 데이터 파일 처리 중 오류 발생:', error);
        alert('파일 처리 중 오류가 발생했습니다.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 데이터 처리 함수
  const processData = () => {
    if (!pickingData || !inventoryData) {
      alert('피킹지와 재고 데이터를 모두 업로드해주세요.');
      return;
    }

    setIsLoading(true);

    try {
      // 재고 데이터에서 키-로케이션 맵 생성
      const inventoryMap = new Map();
      
      inventoryData.forEach(item => {
        const productCode = item['상품코드'] || '';
        const expiryDate = item['유통기한'] || '';
        const lot = item['LOT'] || '';
        const location = item['다중로케이션'] || '';
        
        // 키 생성: 상품코드&유통기한&LOT
        const key = `${productCode}&${expiryDate}&${lot}`;
        
        // 맵에 저장
        if (key && location) {
          inventoryMap.set(key, location);
        }
      });

      // 피킹 데이터 처리 - 정상수량이 0인 행은 무시
      const filteredPickingData = pickingData.filter(item => {
        const normalQuantity = parseFloat(item['정상수량'] || 0);
        return normalQuantity !== 0;
      });

      // 추천 로케이션 추가
      const result = filteredPickingData.map(item => {
        const productCode = item['상품코드'] || '';
        const expiryDate = item['유통기한'] || '';
        const lot = item['LOT'] || '';
        
        // 키 생성
        const key = `${productCode}&${expiryDate}&${lot}`;
        
        // 필요한 필드만 추출
        return {
          '상품코드': productCode,
          '상품명': item['상품명'] || '',
          '유통기한': expiryDate,
          'LOT': lot,
          '정상수량': item['정상수량'] || '',
          '정상다중로케이션': item['정상다중로케이션'] || '',
          '추천로케이션': inventoryMap.get(key) || '',
          '적치로케이션': ''
        };
      });

      setProcessedData(result);
    } catch (error) {
      console.error('데이터 처리 중 오류 발생:', error);
      alert('데이터 처리 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // ExcelJS를 사용한 엑셀 내보내기 함수
  const exportToExcel = async () => {
    if (!processedData || processedData.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    try {
      // 새 워크북 생성
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('피킹지_추천로케이션');

      // 컬럼 정의
      const columns = [
        { header: '상품코드', key: '상품코드', width: 15 },
        { header: '상품명', key: '상품명', width: 30 },
        { header: '유통기한', key: '유통기한', width: 15 },
        { header: 'LOT', key: 'LOT', width: 15 },
        { header: '정상수량', key: '정상수량', width: 10 },
        { header: '정상다중로케이션', key: '정상다중로케이션', width: 20 },
        { header: '추천로케이션', key: '추천로케이션', width: 20 },
        { header: '적치로케이션', key: '적치로케이션', width: 20 }
      ];
      
      worksheet.columns = columns;

      // 페이지 설정 (인쇄 설정)
      worksheet.pageSetup = {
        orientation: 'landscape',  // 가로 방향
        fitToPage: true,           // 페이지에 맞추기 활성화
        fitToWidth: 1,             // 모든 열을 1페이지 너비에 맞추기
        fitToHeight: 0,            // 높이는 제한 없음 (0 = 자동)
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.75,
          bottom: 0.75,
          header: 0.3,
          footer: 0.3
        },
        printTitlesRow: '1:1'     // 첫 번째 행(헤더)을 모든 페이지에 반복
      };

      // 인쇄 영역 설정
      worksheet.printArea = `A1:H${processedData.length + 1}`;

      // 헤더 스타일 설정
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'E6F0FF' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // 데이터 추가
      processedData.forEach(item => {
        worksheet.addRow({
          '상품코드': item['상품코드'],
          '상품명': item['상품명'],
          '유통기한': item['유통기한'],
          'LOT': item['LOT'],
          '정상수량': item['정상수량'],
          '정상다중로케이션': item['정상다중로케이션'],
          '추천로케이션': item['추천로케이션'],
          '적치로케이션': item['적치로케이션']
        });
      });

      // 모든 셀에 테두리 추가
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // 헤더 제외
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
            
            // 추천로케이션 셀 강조
            if (columns[cell.col - 1]?.key === '추천로케이션' && cell.value) {
              cell.font = { color: { argb: '0000FF' }, bold: true };
            }

            // 텍스트 정렬 설정
            if (columns[cell.col - 1]?.key === '상품명') {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            } else {
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
          });
        }
      });

      // 번갈아가는 행 색상
      processedData.forEach((_, index) => {
        if (index % 2 === 0) {
          const rowNumber = index + 2; // 헤더 행(1) + 데이터 시작 행(1)
          worksheet.getRow(rowNumber).eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'F5F5F5' }
            };
          });
        }
      });

      // 엑셀 파일 생성 및 다운로드
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, '피킹지_추천로케이션.xlsx');
      
    } catch (error) {
      console.error('엑셀 내보내기 중 오류 발생:', error);
      alert('엑셀 내보내기 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">피킹지 추천 로케이션 생성</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 border rounded">
          <h2 className="text-lg font-semibold mb-2">1. 피킹지 데이터 업로드</h2>
          <p className="text-sm text-gray-600 mb-2">* 2행에 컬럼명이 있는 엑셀 파일을 업로드하세요.</p>
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handlePickingUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {pickingData && (
            <p className="text-sm text-green-600 mt-2">
              {pickingData.length}개의 데이터가 로드되었습니다.
            </p>
          )}
        </div>
        
        <div className="p-4 border rounded">
          <h2 className="text-lg font-semibold mb-2">2. 재고 데이터 업로드</h2>
          <p className="text-sm text-gray-600 mb-2">* 2행에 컬럼명이 있는 엑셀 파일을 업로드하세요.</p>
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handleInventoryUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {inventoryData && (
            <p className="text-sm text-green-600 mt-2">
              {inventoryData.length}개의 데이터가 로드되었습니다.
            </p>
          )}
        </div>
      </div>
      
      <div className="flex justify-center space-x-4 mb-6">
        <button
          onClick={processData}
          disabled={!pickingData || !inventoryData || isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isLoading ? '처리 중...' : '데이터 처리'}
        </button>
        
        <button
          onClick={exportToExcel}
          disabled={!processedData || isLoading}
          className="px-4 py-2 bg-green-600 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          엑셀 내보내기
        </button>
      </div>
      
      {processedData && (
        <div className="overflow-x-auto">
          <h2 className="text-lg font-semibold mb-2">처리 결과 ({processedData.length}개)</h2>
          <table className="min-w-full bg-white border-collapse border">
            <thead>
              <tr className="bg-blue-100">
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">상품코드</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">상품명</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">유통기한</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">LOT</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상수량</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">정상다중로케이션</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">추천로케이션</th>
                <th className="px-4 py-2 border border-gray-300 text-center font-bold">적치로케이션</th>
              </tr>
            </thead>
            <tbody>
              {processedData.slice(0, 10).map((item, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['상품코드']}</td>
                  <td className="px-4 py-2 border border-gray-300">{item['상품명']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['유통기한']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['LOT']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['정상수량']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center">{item['정상다중로케이션']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center font-bold text-blue-600">{item['추천로케이션']}</td>
                  <td className="px-4 py-2 border border-gray-300 text-center"></td>
                </tr>
              ))}
            </tbody>
          </table>
          {processedData.length > 10 && (
            <p className="text-sm text-gray-600 mt-2">
              * 처음 10개 데이터만 표시됩니다. 전체 데이터는 엑셀 내보내기를 이용하세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}