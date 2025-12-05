// pages/weight-check/index.js
import { useState } from 'react';
import Head from 'next/head';
import AuthLayout from '@/components/AuthLayout';
import { supabase } from '/lib/supabase';
import ExcelJS from 'exceljs';

export default function WeightCheck() {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 변경 이력 관련 상태
  const [historyModal, setHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyProductCode, setHistoryProductCode] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  // 상품코드 조회 함수
  const handleSearch = async () => {
    setError('');
    setLoading(true);

    try {
      // 입력된 텍스트를 줄바꿈으로 분리하고 공백 제거
      const productCodes = inputText
        .split('\n')
        .map(code => code.trim())
        .filter(code => code !== '');

      if (productCodes.length === 0) {
        setError('상품코드를 입력해주세요.');
        setLoading(false);
        return;
      }

      // Supabase에서 상품 정보 조회
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('product_code, product_name, ea_per_box, weight_per_box')
        .in('product_code', productCodes);

      if (fetchError) {
        throw fetchError;
      }

      // 조회된 결과를 입력 순서대로 정렬
      const sortedResults = productCodes.map(code => {
        const found = data.find(item => item.product_code === code);
        return found || {
          product_code: code,
          product_name: null,
          ea_per_box: null,
          weight_per_box: null,
          notFound: true
        };
      });

      setResults(sortedResults);
    } catch (err) {
      console.error('Error fetching product info:', err);
      setError('조회 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 엔터키로 검색
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSearch();
    }
  };

  // 결과 초기화
  const handleReset = () => {
    setInputText('');
    setResults([]);
    setError('');
  };

  // 변경 이력 조회
  const handleViewHistory = async (productCode) => {
    setHistoryProductCode(productCode);
    setHistoryLoading(true);
    setHistoryModal(true);

    try {
      const { data, error: fetchError } = await supabase
        .from('product_history')
        .select('*')
        .eq('product_code', productCode)
        .order('changed_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setHistoryData(data || []);
    } catch (err) {
      console.error('이력 조회 오류:', err);
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 클립보드 복사 함수 (엑셀 붙여넣기용 - 4열 형식)
  const copyToClipboard = () => {
    if (results.length === 0) return;

    // 헤더 포함
    const header = '상품코드\t상품명\tEA/BOX\t박스당중량(kg)';

    const dataRows = results
      .map(item => {
        // 상품명에서 탭, 줄바꿈 제거 (엑셀 열 밀림 방지)
        const cleanName = item.notFound
          ? '없음'
          : (item.product_name || '-').replace(/[\t\n\r]/g, ' ');

        return [
          item.product_code || '-',
          cleanName,
          item.notFound ? '-' : (item.ea_per_box ?? '-'),
          item.notFound ? '-' : (item.weight_per_box ?? '-')
        ].join('\t');
      })
      .join('\n');

    const textToCopy = header + '\n' + dataRows;

    navigator.clipboard.writeText(textToCopy).then(() => {
      alert('클립보드에 복사되었습니다!\n엑셀에 Ctrl+V로 붙여넣기 하세요.');
    }).catch(err => {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    });
  };

  // 엑셀 다운로드 함수
  const downloadExcel = async () => {
    if (results.length === 0) return;

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = '무게 조회 시스템';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('무게 조회 결과');

      // 헤더 행 추가
      const headerRow = sheet.addRow(['번호', '상품코드', '상품명', 'EA/BOX', '박스 당 중량(kg)']);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      // 데이터 행 추가
      results.forEach((item, index) => {
        const row = sheet.addRow([
          index + 1,
          item.product_code,
          item.notFound ? '없음' : (item.product_name || '-'),
          item.notFound ? '-' : (item.ea_per_box || '-'),
          item.notFound ? '-' : (item.weight_per_box || '-')
        ]);

        // 찾지 못한 상품은 빨간색 배경
        if (item.notFound) {
          row.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFEE2E2' }
            };
          });
        }

        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // 열 너비 조정
      sheet.getColumn(1).width = 8;   // 번호
      sheet.getColumn(2).width = 20;  // 상품코드
      sheet.getColumn(3).width = 50;  // 상품명
      sheet.getColumn(4).width = 12;  // EA/BOX
      sheet.getColumn(5).width = 18;  // 박스 당 중량

      // 파일 다운로드
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);

      const today = new Date();
      const dateStr = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;
      const fileName = `무게조회_${dateStr}.xlsx`;

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('엑셀 다운로드 오류:', err);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  return (
    <AuthLayout>
      <Head>
        <title>무게 조회</title>
      </Head>
      <main className="min-h-screen bg-gray-50 px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-md p-6">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-4">
            상품 무게 조회
          </h1>
          <p className="text-center text-sm text-gray-500 mb-6">
            상품코드를 줄바꿈으로 입력하세요 (Ctrl+Enter로 조회)
          </p>

          {/* 입력 영역 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              상품코드 입력
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="상품코드를 입력하세요&#10;예:&#10;1000001&#10;1000002&#10;1000003"
              className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              * 한 줄에 하나씩 상품코드를 입력하세요
            </p>
          </div>

          {/* 버튼 영역 */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={handleSearch}
              disabled={loading || !inputText.trim()}
              className={`flex-1 px-4 py-2 text-white rounded-md transition-colors ${
                loading || !inputText.trim()
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {loading ? '조회 중...' : '🔍 조회하기'}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              초기화
            </button>
            {results.length > 0 && (
              <>
                <button
                  onClick={copyToClipboard}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  📋 복사
                </button>
                <button
                  onClick={downloadExcel}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                >
                  📥 엑셀 다운로드
                </button>
              </>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md">
              {error}
            </div>
          )}

          {/* 결과 테이블 */}
          {results.length > 0 && (
            <div className="overflow-x-auto">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold text-gray-800">
                  조회 결과 ({results.length}건)
                </h2>
                <span className="text-xs text-gray-500">
                  테이블을 드래그하여 선택 후 Ctrl+C로 복사하세요
                </span>
              </div>
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300 select-text cursor-text">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      번호
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      상품코드
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      상품명
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      EA/BOX
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      박스 당 중량(kg)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((item, index) => (
                    <tr
                      key={index}
                      className={`${item.notFound ? 'bg-red-50' : 'hover:bg-blue-50'} select-text`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 select-text">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 select-text">
                        <button
                          onClick={() => handleViewHistory(item.product_code)}
                          className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                          title="변경 이력 보기"
                        >
                          {item.product_code}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 select-text">
                        {item.notFound ? (
                          <span className="text-red-600 font-semibold">없음</span>
                        ) : (
                          item.product_name || '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right select-text">
                        {item.notFound ? '-' : (item.ea_per_box || '-')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right select-text">
                        {item.notFound ? '-' : (item.weight_per_box || '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 통계 정보 */}
              <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-200">
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="font-semibold text-gray-700">총 조회:</span>
                    <span className="ml-2 text-gray-900">{results.length}건</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">찾음:</span>
                    <span className="ml-2 text-green-600 font-semibold">
                      {results.filter(r => !r.notFound).length}건
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">없음:</span>
                    <span className="ml-2 text-red-600 font-semibold">
                      {results.filter(r => r.notFound).length}건
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 변경 이력 모달 */}
      {historyModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setHistoryModal(false)}
        >
          <div
            className="bg-white rounded-lg p-6 w-[800px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">
                변경 이력 - {historyProductCode}
              </h2>
              <button
                onClick={() => setHistoryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {historyLoading ? (
              <div className="text-center py-8 text-gray-500">로딩 중...</div>
            ) : historyData.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                변경 이력이 없습니다.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      변경일시
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      EA/BOX
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      박스당중량(kg)
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      변경자
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      출처
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {historyData.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-900">
                        {new Date(item.changed_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-right">
                        {item.ea_per_box ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-right">
                        {item.weight_per_box ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {item.changed_by || '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {item.source || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setHistoryModal(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
