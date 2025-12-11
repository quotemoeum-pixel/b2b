import { useState } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import AuthLayout from '@/components/AuthLayout';

export default function Find() {
  const [processedData, setProcessedData] = useState([]);
  const [error, setError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');

  // 로케이션 파싱 함수
  const parseLocation = (location) => {
    if (!location) return null;
    const parts = location.toString().trim().split('-');
    if (parts.length < 4) return null;

    return {
      prefix: parts[0], // AA, CC 등
      row: parts[1],    // 행
      col: parts[2],    // 열
      level: parts[3],  // 단
      original: location.toString().trim()
    };
  };

  // A 또는 C로 시작하는지 확인
  const isValidPrefix = (prefix) => {
    if (!prefix) return false;
    const firstChar = prefix.charAt(0).toUpperCase();
    return firstChar === 'A' || firstChar === 'C';
  };

  // 중복 키 생성 (행-열-단)
  const createDuplicateKey = (parsed) => {
    if (!parsed) return null;
    return `${parsed.row}-${parsed.col}-${parsed.level}`;
  };

  // 엑셀 다운로드
  const handleDownloadExcel = () => {
    if (processedData.length === 0) return;

    const excelData = processedData.map((item, index) => ({
      'No': index + 1,
      '행': item.row,
      '열': item.col,
      '단': item.level
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '로케이션');
    XLSX.writeFile(wb, `재고찾기_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // 엑셀 파일 업로드 처리
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setUploadedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 2행이 헤더이므로 range: 1로 설정 (0-indexed)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: 1 });

        const uniqueLocations = new Map(); // 중복 제거용

        jsonData.forEach(item => {
          const location = (item['다중로케이션'] || '').toString().trim();
          if (!location) return;

          // 로케이션 파싱
          const parsed = parseLocation(location);
          if (!parsed) return;

          // A 또는 C로 시작하는 것만 필터링
          if (!isValidPrefix(parsed.prefix)) return;

          const dupKey = createDuplicateKey(parsed);

          // 중복 키가 없으면 추가
          if (!uniqueLocations.has(dupKey)) {
            uniqueLocations.set(dupKey, {
              location: parsed.original,
              parsed,
              row: parsed.row,
              col: parsed.col,
              level: parsed.level
            });
          }
        });

        // 배열로 변환 후 정렬 (행 → 열 → 단)
        const sortedData = Array.from(uniqueLocations.values()).sort((a, b) => {
          // 행 비교
          const rowA = parseInt(a.row, 10) || 0;
          const rowB = parseInt(b.row, 10) || 0;
          if (rowA !== rowB) return rowA - rowB;

          // 열 비교
          const colA = parseInt(a.col, 10) || 0;
          const colB = parseInt(b.col, 10) || 0;
          if (colA !== colB) return colA - colB;

          // 단 비교
          const levelA = parseInt(a.level, 10) || 0;
          const levelB = parseInt(b.level, 10) || 0;
          return levelA - levelB;
        });

        setProcessedData(sortedData);

        if (sortedData.length === 0) {
          setError('A 또는 C로 시작하는 로케이션이 없습니다.');
        }
      } catch (err) {
        console.error('엑셀 파일 처리 오류:', err);
        setError('엑셀 파일 처리 중 오류가 발생했습니다: ' + err.message);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <AuthLayout>
      <Head>
        <title>재고찾기</title>
        <meta name="description" content="로케이션 정렬" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="py-10">
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
            재고찾기
          </h1>

          {/* 엑셀 업로드 */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              엑셀 파일 업로드
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {uploadedFileName && (
              <p className="mt-2 text-sm text-green-600">
                ✓ {uploadedFileName}
              </p>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 결과 */}
          {processedData.length > 0 && (
            <div className="mt-6">
              <div className="mb-4 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-800">
                  결과
                </h2>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    총 {processedData.length}개
                  </span>
                  <button
                    onClick={handleDownloadExcel}
                    className="px-4 py-2 bg-green-500 text-white text-sm font-medium rounded hover:bg-green-600"
                  >
                    엑셀 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="min-w-full border-collapse border border-gray-200">
                  <thead className="sticky top-0 bg-gray-100">
                    <tr>
                      <th className="py-2 px-4 border border-gray-200 text-center">No</th>
                      <th className="py-2 px-4 border border-gray-200 text-center">행</th>
                      <th className="py-2 px-4 border border-gray-200 text-center">열</th>
                      <th className="py-2 px-4 border border-gray-200 text-center">단</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="py-2 px-4 border border-gray-200 text-center">{index + 1}</td>
                        <td className="py-2 px-4 border border-gray-200 text-center">{item.row}</td>
                        <td className="py-2 px-4 border border-gray-200 text-center">{item.col}</td>
                        <td className="py-2 px-4 border border-gray-200 text-center">{item.level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </AuthLayout>
  );
}
