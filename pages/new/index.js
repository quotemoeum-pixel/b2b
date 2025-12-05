import React, { useState, useMemo } from 'react';
import { Upload, Search, Filter, Download, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import AuthLayout from '@/components/AuthLayout';

export default function WarehouseMobileApp() {
  const [data, setData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedRow, setSelectedRow] = useState('');
  const [selectedColumn, setSelectedColumn] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      
      // 2행부터 데이터 읽기 (1행은 제목, 2행이 컬럼명)
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
        range: 1, // 2행부터 시작 (0-based index)
        defval: '' // 빈 값 처리
      });

      // 컬럼명 정규화
      const normalizedData = jsonData.map((row, index) => {
        const normalizedRow = {};
        Object.keys(row).forEach(key => {
          const normalizedKey = key.trim().toLowerCase();
          if (normalizedKey.includes('창고')) normalizedRow.warehouse = row[key];
          else if (normalizedKey.includes('상품명')) normalizedRow.productName = row[key];
          else if (normalizedKey.includes('상품코드')) normalizedRow.productCode = row[key];
          else if (normalizedKey.includes('유통기한')) normalizedRow.expiryDate = row[key];
          else if (normalizedKey.includes('lot')) normalizedRow.lot = row[key];
          else if (normalizedKey.includes('로케이션')) normalizedRow.location = row[key];
          else if (normalizedKey.includes('재고')) normalizedRow.stock = row[key];
          else if (normalizedKey.includes('행')) normalizedRow.row = row[key];
          else if (normalizedKey.includes('열')) normalizedRow.column = row[key];
          else if (normalizedKey.includes('단')) normalizedRow.level = row[key];
        });
        normalizedRow.id = index + 1;
        return normalizedRow;
      }).filter(row => row.productName || row.productCode); // 빈 행 제거

      setData(normalizedData);
    } catch (error) {
      alert('파일 읽기 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 필터 옵션들 추출
  const filterOptions = useMemo(() => {
    const warehouses = [...new Set(data.map(item => item.warehouse).filter(Boolean))].sort();
    const rows = [...new Set(data.map(item => item.row).filter(Boolean))].sort();
    const columns = [...new Set(data.map(item => item.column).filter(Boolean))].sort();
    const levels = [...new Set(data.map(item => item.level).filter(Boolean))].sort();
    
    return { warehouses, rows, columns, levels };
  }, [data]);

  // 필터링된 데이터
  const filteredData = useMemo(() => {
    return data.filter(item => {
      const matchesSearch = !searchTerm || 
        item.productName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.productCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.lot?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesWarehouse = !selectedWarehouse || item.warehouse === selectedWarehouse;
      const matchesRow = !selectedRow || item.row === selectedRow;
      const matchesColumn = !selectedColumn || item.column === selectedColumn;
      const matchesLevel = !selectedLevel || item.level === selectedLevel;
      
      return matchesSearch && matchesWarehouse && matchesRow && matchesColumn && matchesLevel;
    });
  }, [data, searchTerm, selectedWarehouse, selectedRow, selectedColumn, selectedLevel]);

  // 유통기한 상태 확인
  const getExpiryClass = (expiryDate) => {
    if (!expiryDate) return '';
    
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'bg-red-100 text-red-800';
    if (diffDays <= 7) return 'bg-orange-100 text-orange-800';
    if (diffDays <= 30) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedWarehouse('');
    setSelectedRow('');
    setSelectedColumn('');
    setSelectedLevel('');
  };

  return (
    <AuthLayout>
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-blue-600 text-white p-3 sticky top-0 z-20 shadow-lg">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">물류센터 재고 확인</h1>
          <div className="text-sm">
            {filteredData.length} / {data.length}
          </div>
        </div>
      </div>

      {/* 파일 업로드 */}
      {data.length === 0 && (
        <div className="p-4">
          <div className="bg-white rounded-lg p-6 shadow-sm border-2 border-dashed border-gray-300">
            <div className="text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="bg-blue-600 text-white px-6 py-3 rounded-lg inline-block font-medium hover:bg-blue-700 transition-colors">
                  {isLoading ? '처리 중...' : '엑셀 파일 업로드'}
                </span>
                <input
                  id="file-upload"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isLoading}
                />
              </label>
              <p className="text-gray-500 text-sm mt-3">
                2행이 컬럼명인 엑셀 파일을 선택하세요
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 검색 및 필터 */}
      {data.length > 0 && (
        <div className="p-3 bg-white border-b space-y-3">
          {/* 검색창 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="상품명, 상품코드, 로케이션, LOT 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {/* 필터 토글 */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              <Filter className="h-4 w-4 mr-2" />
              필터 {showFilters ? '숨기기' : '보기'}
            </button>
            
            <div className="flex space-x-2">
              <button
                onClick={clearFilters}
                className="flex items-center px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                초기화
              </button>
              
              <label htmlFor="new-file-upload" className="cursor-pointer">
                <div className="flex items-center px-3 py-2 bg-blue-100 rounded-lg text-sm hover:bg-blue-200 transition-colors">
                  <Upload className="h-4 w-4 mr-1" />
                  새 파일
                </div>
                <input
                  id="new-file-upload"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isLoading}
                />
              </label>
            </div>
          </div>

          {/* 필터 옵션들 */}
          {showFilters && (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedWarehouse}
                onChange={(e) => setSelectedWarehouse(e.target.value)}
                className="p-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
              >
                <option value="">전체 창고</option>
                {filterOptions.warehouses.map(warehouse => (
                  <option key={warehouse} value={warehouse}>{warehouse}</option>
                ))}
              </select>

              <select
                value={selectedRow}
                onChange={(e) => setSelectedRow(e.target.value)}
                className="p-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
              >
                <option value="">전체 행</option>
                {filterOptions.rows.map(row => (
                  <option key={row} value={row}>{row}행</option>
                ))}
              </select>

              <select
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(e.target.value)}
                className="p-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
              >
                <option value="">전체 열</option>
                {filterOptions.columns.map(column => (
                  <option key={column} value={column}>{column}열</option>
                ))}
              </select>

              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="p-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
              >
                <option value="">전체 단</option>
                {filterOptions.levels.map(level => (
                  <option key={level} value={level}>{level}단</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* 테이블 */}
      {data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full bg-white text-xs">
            <thead className="bg-gray-100 sticky top-16 z-10">
              <tr>
                <th className="px-2 py-2 text-left font-semibold border-b min-w-24">창고</th>
                <th className="px-2 py-2 text-left font-semibold border-b min-w-32">상품명</th>
                <th className="px-2 py-2 text-left font-semibold border-b min-w-20">상품코드</th>
                <th className="px-2 py-2 text-center font-semibold border-b min-w-16">재고</th>
                <th className="px-2 py-2 text-left font-semibold border-b min-w-20">로케이션</th>
                <th className="px-2 py-2 text-left font-semibold border-b min-w-20">LOT</th>
                <th className="px-2 py-2 text-center font-semibold border-b min-w-20">유통기한</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((item) => (
                <tr key={item.id} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="px-2 py-2 font-medium text-blue-700">{item.warehouse || '-'}</td>
                  <td className="px-2 py-2 font-medium leading-tight">{item.productName || '-'}</td>
                  <td className="px-2 py-2 font-mono text-gray-600">{item.productCode || '-'}</td>
                  <td className="px-2 py-2 text-center font-bold text-green-700">{item.stock || '0'}</td>
                  <td className="px-2 py-2 text-gray-600">{item.location || '-'}</td>
                  <td className="px-2 py-2 font-mono text-purple-600">{item.lot || '-'}</td>
                  <td className={`px-2 py-1 text-center text-xs rounded ${getExpiryClass(item.expiryDate)}`}>
                    {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('ko-KR') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 데이터 없음 메시지 */}
          {filteredData.length === 0 && (
            <div className="text-center py-8 bg-white">
              <Search className="mx-auto h-12 w-12 text-gray-400 mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">검색 결과가 없습니다</h3>
              <p className="text-gray-500">다른 검색어나 필터를 시도해보세요</p>
            </div>
          )}
        </div>
      )}
    </div>
    </AuthLayout>
  );
}
