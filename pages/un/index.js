import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Head from 'next/head';
import AuthLayout from '@/components/AuthLayout';

export default function Home() {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [columnMapping, setColumnMapping] = useState({});
  
  // 드래그 선택 상태
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [lastHovered, setLastHovered] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsLoading(true);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        alert('파일에 데이터가 충분하지 않습니다. (최소 헤더 + 1행 필요)');
        setIsLoading(false);
        return;
      }

      // 1행은 헤더, 2행부터 데이터
      const headers = jsonData[0];
      const rows = jsonData.slice(1);

      // 헤더명으로 컬럼 인덱스 찾기
      const mapping = {};
      headers.forEach((header, index) => {
        if (header) {
          const normalizedHeader = header.toString().trim();
          mapping[normalizedHeader] = index;
        }
      });
      
      setColumnMapping(mapping);

      // 헤더명 기반으로 데이터 매핑
      const mappedData = rows
        .filter(row => row && row.some(cell => cell !== null && cell !== undefined && cell !== ''))
        .map((row, rowIndex) => ({
          id: `row-${rowIndex}`,
          rowIndex,
          No: getValueByHeader(row, mapping, 'No') || '',
          접수일자: getValueByHeader(row, mapping, '접수일자') || '',
          운송장번호: getValueByHeader(row, mapping, '운송장번호') || '',
          받는분명: getValueByHeader(row, mapping, '받는분명') || '',
          받는분전화번호: getValueByHeader(row, mapping, '받는분전화번호') || '',
          받는분주소: getValueByHeader(row, mapping, '받는분주소') || '',
          상품명: getValueByHeader(row, mapping, '상품명') || '',
          배송메세지1: getValueByHeader(row, mapping, '배송메세지1') || '',
          운임: getValueByHeader(row, mapping, '운임') || ''
        }));

      setData(mappedData);
      setFilteredData(mappedData);
      setSelectedRows(new Set());
    } catch (error) {
      alert('파일 읽기 중 오류가 발생했습니다. 파일 형식을 확인해주세요.');
      console.error(error);
    }
    
    setIsLoading(false);
  };

  const getValueByHeader = (row, mapping, headerName) => {
    const index = mapping[headerName];
    if (index === undefined) return '';
    const value = row[index];
    return value !== null && value !== undefined ? value.toString() : '';
  };

  const handleFilterChange = (value) => {
    setFilter(value);
    applyFilter(value);
  };

  const applyFilter = useCallback((filterValue) => {
    if (!filterValue.trim()) {
      setFilteredData(data);
      return;
    }

    const searchTerm = filterValue.toLowerCase();
    const filtered = data.filter(item => {
      const searchFields = [
        item.접수일자,
        item.운송장번호,
        item.받는분명,
        item.받는분전화번호,
        item.받는분주소,
        item.상품명,
        item.배송메세지1,
        item.운임
      ];
      
      return searchFields.some(field => 
        field.toLowerCase().includes(searchTerm)
      );
    });

    setFilteredData(filtered);
    
    // 필터링 후 선택된 행들 중 보이지 않는 것들 제거
    const visibleIds = new Set(filtered.map(item => item.id));
    setSelectedRows(prev => new Set([...prev].filter(id => visibleIds.has(id))));
  }, [data]);

  const clearFilter = () => {
    setFilter('');
    setFilteredData(data);
  };

  const toggleRowSelection = (rowId, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    });
  };

  const selectAllVisible = () => {
    const allVisibleIds = filteredData.map(item => item.id);
    setSelectedRows(new Set(allVisibleIds));
  };

  const clearSelection = () => {
    setSelectedRows(new Set());
  };

  const copySelectedTrackingNumbers = async () => {
    const selectedData = filteredData.filter(item => selectedRows.has(item.id));
    const trackingNumbers = selectedData
      .map(item => item.운송장번호)
      .filter(num => num.trim()) // 빈 값 제외
      .map(num => num.replace(/-/g, '')) // 하이픈 제거
      .filter(num => num); // 빈 값 재확인

    if (trackingNumbers.length === 0) {
      alert('복사할 운송장번호가 없습니다.');
      return;
    }

    // "송장번호 드립니다" 텍스트를 맨 위에 추가
    const formattedText = '송장번호 드립니다\n' + trackingNumbers.join('\n');

    try {
      await navigator.clipboard.writeText(formattedText);
      alert(`${trackingNumbers.length}개의 운송장번호가 클립보드에 복사되었습니다.`);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = formattedText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`${trackingNumbers.length}개의 운송장번호가 클립보드에 복사되었습니다.`);
    }
  };

  // 드래그 선택 시작
  const handleMouseDown = (event, rowId) => {
    if (event.button !== 0) return; // 좌클릭만
    
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd + 클릭: 개별 토글
      toggleRowSelection(rowId);
    } else if (event.shiftKey && selectionStart) {
      // Shift + 클릭: 범위 선택
      selectRange(selectionStart, rowId);
    } else {
      // 일반 클릭: 새로운 선택 시작
      setIsSelecting(true);
      setSelectionStart(rowId);
      setLastHovered(rowId);
      
      // 기존 선택이 있고 클릭한 행이 선택되어 있으면 해제, 아니면 새로 선택
      if (selectedRows.has(rowId) && selectedRows.size === 1) {
        setSelectedRows(new Set());
      } else {
        setSelectedRows(new Set([rowId]));
      }
    }
  };

  // 드래그 중 마우스 이동
  const handleMouseEnter = (rowId) => {
    if (!isSelecting || !selectionStart) return;
    
    setLastHovered(rowId);
    selectRange(selectionStart, rowId);
  };

  // 범위 선택
  const selectRange = (startId, endId) => {
    const startIndex = filteredData.findIndex(item => item.id === startId);
    const endIndex = filteredData.findIndex(item => item.id === endId);
    
    if (startIndex === -1 || endIndex === -1) return;
    
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    
    const rangeIds = filteredData.slice(start, end + 1).map(item => item.id);
    setSelectedRows(new Set(rangeIds));
  };

  // 드래그 종료
  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  // 전역 마우스 업 이벤트 처리
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseleave', handleMouseUp);
    
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [handleMouseUp]);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'a') {
          event.preventDefault();
          selectAllVisible();
        } else if (event.key === 'd') {
          event.preventDefault();
          clearSelection();
        } else if (event.key === 'c' && selectedRows.size > 0) {
          event.preventDefault();
          copySelectedTrackingNumbers();
        }
      }
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedRows]);

  const getRowClassName = (rowId) => {
    const isSelected = selectedRows.has(rowId);
    const isHovered = isSelecting && lastHovered === rowId;
    
    let className = 'cursor-pointer transition-all duration-150 border-l-4 ';
    
    if (isSelected) {
      className += 'bg-blue-50 border-l-blue-500 ';
    } else {
      className += 'border-l-transparent hover:bg-gray-50 ';
    }
    
    if (isHovered) {
      className += 'bg-blue-100 ';
    }
    
    return className;
  };

  return (
    <AuthLayout>
      <Head>
        <title>송장</title>
      </Head>
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg">
          {/* 헤더 */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <h1 className="text-2xl font-bold text-gray-900">📋 엑셀 데이터 필터링</h1>
            <p className="mt-1 text-sm text-gray-600">
              엑셀 파일을 업로드하고 데이터를 필터링하여 운송장번호를 복사하세요.
            </p>
          </div>

          <div className="p-6">
            {/* 파일 업로드 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                📁 엑셀 파일 업로드
              </label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-blue-400 transition-colors">
                <div className="space-y-1 text-center">
                  <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="flex text-sm text-gray-600">
                    <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                      <span>파일을 선택하거나</span>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileUpload}
                        className="sr-only"
                        disabled={isLoading}
                      />
                    </label>
                    <p className="pl-1">드래그하여 업로드</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    xlsx, xls, csv 파일만 지원
                  </p>
                </div>
              </div>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="relative">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-6 w-6 bg-blue-600 rounded-full animate-pulse"></div>
                  </div>
                </div>
                <span className="ml-3 text-gray-600 font-medium">파일을 읽는 중...</span>
              </div>
            )}

            {data.length > 0 && (
              <>
                {/* 컬럼 매핑 정보 */}
                <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center mb-2">
                    <svg className="h-5 w-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <h4 className="text-sm font-medium text-green-900">✅ 파일 업로드 완료</h4>
                  </div>
                  <div className="text-sm text-green-700">
                    <span className="font-medium">감지된 컬럼:</span> {Object.keys(columnMapping).join(', ')}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    총 {data.length}개의 데이터 행이 로드되었습니다.
                  </div>
                </div>

                {/* 통합 필터 및 컨트롤 */}
                <div className="mb-6 p-5 bg-gray-50 rounded-lg border">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex-1 max-w-md">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        🔍 통합 검색
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={filter}
                          onChange={(e) => handleFilterChange(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="운송장번호, 받는분명, 전화번호, 주소, 상품명, 배송메세지 검색..."
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      </div>
                      {filter && (
                        <p className="mt-1 text-xs text-gray-500">
                          &quot;{filter}&quot;로 검색 중 - {filteredData.length}개 결과
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={selectAllVisible}
                        className="px-4 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={filteredData.length === 0}
                      >
                        ✅ 전체 선택
                      </button>
                      <button
                        onClick={clearSelection}
                        className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                      >
                        ❌ 선택 해제
                      </button>
                      <button
                        onClick={clearFilter}
                        className="px-4 py-2 text-sm bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors font-medium"
                      >
                        🔄 필터 초기화
                      </button>
                      <button
                        onClick={copySelectedTrackingNumbers}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                        disabled={selectedRows.size === 0}
                      >
                        📋 운송장번호 복사 ({selectedRows.size}개)
                      </button>
                    </div>
                  </div>
                </div>

                {/* 데이터 테이블 */}
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">선택</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">No</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">접수일자</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">운송장번호</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">받는분명</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">받는분전화번호</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">받는분주소</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품명</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">배송메세지1</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">운임</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredData.map((row, index) => (
                          <tr
                            key={row.id}
                            className={getRowClassName(row.id)}
                            onMouseDown={(e) => handleMouseDown(e, row.id)}
                            onMouseEnter={() => handleMouseEnter(row.id)}
                            style={{ userSelect: 'none' }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <input
                                type="checkbox"
                                checked={selectedRows.has(row.id)}
                                onChange={(e) => toggleRowSelection(row.id, e)}
                                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.No}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.접수일자}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-blue-600 bg-blue-50 rounded">{row.운송장번호}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.받는분명}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.받는분전화번호}</td>
                            <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title={row.받는분주소}>{row.받는분주소}</td>
                            <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title={row.상품명}>{row.상품명}</td>
                            <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title={row.배송메세지1}>{row.배송메세지1}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.운임}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {filteredData.length === 0 && (
                      <div className="text-center py-12">
                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.206 0-4.206.896-5.656 2.344M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <p className="mt-2 text-gray-500">검색 조건에 맞는 데이터가 없습니다.</p>
                        <button
                          onClick={clearFilter}
                          className="mt-2 text-blue-600 hover:text-blue-500 text-sm"
                        >
                          필터를 초기화하시겠습니까?
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 상태 바 */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm text-gray-600 bg-gray-50 px-4 py-3 rounded-lg">
                  <div>
                    전체 <span className="font-semibold text-gray-900">{data.length}</span>개 중{' '}
                    <span className="font-semibold text-blue-600">{filteredData.length}</span>개 표시 |{' '}
                    <span className="font-semibold text-green-600">{selectedRows.size}</span>개 선택됨
                  </div>
                  <div className="mt-2 sm:mt-0 text-xs text-gray-500">
                    💡 팁: 클릭/드래그로 선택, Ctrl+클릭으로 다중선택, Shift+클릭으로 범위선택
                  </div>
                </div>

                {/* 키보드 단축키 안내 */}
                <div className="mt-3 text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded">
                  <span className="font-medium">키보드 단축키:</span> Ctrl+A (전체선택) | Ctrl+D (선택해제) | Ctrl+C (복사) | ESC (선택해제)
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </AuthLayout>
  );
}
