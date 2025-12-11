import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Copy, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

const LocationAssignmentApp = () => {
  const [excelData, setExcelData] = useState([]);
  const [rows, setRows] = useState([]);
  const fileInputRef = useRef(null);

  // 엑셀 파일 읽기
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // 전체 데이터를 배열로 변환
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // 2행을 헤더로 사용 (인덱스 1)
      const headers = jsonData[1];
      const dataRows = jsonData.slice(2); // 3행부터 데이터
      
      // 필요한 컬럼 인덱스 찾기
      const columnIndexes = {
        productCode: headers.findIndex(h => h && h.toString().includes('상품코드')),
        productName: headers.findIndex(h => h && h.toString().includes('상품명')),
        barcode: headers.findIndex(h => h && h.toString().includes('바코드')),
        quantity: headers.findIndex(h => h && h.toString().includes('예정수량'))
      };
      
      // 데이터 파싱
      const parsedData = dataRows
        .filter(row => row[columnIndexes.productCode]) // 상품코드가 있는 행만
        .map((row, index) => ({
          id: index + 1,
          productCode: row[columnIndexes.productCode] || '',
          productName: row[columnIndexes.productName] || '',
          barcode: row[columnIndexes.barcode] || '',
          quantity: parseInt(row[columnIndexes.quantity]) || 0
        }));
      
      setExcelData(parsedData);
      
      // 각 상품마다 초기 행 생성
      const initialRows = parsedData.map(item => ({
        id: `${item.id}-1`,
        productId: item.id,
        productCode: item.productCode,
        productName: item.productName,
        barcode: item.barcode,
        totalQuantity: item.quantity,
        location: '',
        quantity: '',
        expiryDate: '',
        lot: ''
      }));
      
      setRows(initialRows);
      
    } catch (error) {
      console.error('파일 읽기 오류:', error);
      alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
    }
  };

  // 로케이션 포맷팅 (8자리 -> XX-XX-XX-XX)
  const formatLocation = (value) => {
    // 숫자와 문자만 남기고 제거
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // 8자리로 제한
    const limited = cleaned.slice(0, 8);
    
    // 2-2-2-2 형식으로 포맷
    let formatted = limited;
    if (limited.length > 2) {
      formatted = limited.slice(0, 2) + '-' + limited.slice(2);
    }
    if (limited.length > 4) {
      formatted = formatted.slice(0, 5) + '-' + limited.slice(4);
    }
    if (limited.length > 6) {
      formatted = formatted.slice(0, 8) + '-' + limited.slice(6);
    }
    
    return formatted;
  };

  // 행 추가
  const addRow = (productId) => {
    const product = excelData.find(p => p.id === productId);
    if (!product) return;

    const productRows = rows.filter(r => r.productId === productId);
    const newRowNumber = productRows.length + 1;
    
    const newRow = {
      id: `${productId}-${newRowNumber}`,
      productId: product.id,
      productCode: product.productCode,
      productName: product.productName,
      barcode: product.barcode,
      totalQuantity: product.quantity,
      location: '',
      quantity: '',
      expiryDate: '',
      lot: ''
    };

    // 해당 상품의 마지막 행 다음에 추가
    const lastIndex = rows.findLastIndex(r => r.productId === productId);
    const newRows = [...rows];
    newRows.splice(lastIndex + 1, 0, newRow);
    setRows(newRows);
  };

  // 행 삭제
  const deleteRow = (rowId) => {
    setRows(rows.filter(row => row.id !== rowId));
  };

  // 남은 수량 계산
  const getRemainingQuantity = (productId) => {
    const product = excelData.find(p => p.id === productId);
    if (!product) return 0;
    
    const assignedQuantity = rows
      .filter(row => row.productId === productId)
      .reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0);
    
    return product.quantity - assignedQuantity;
  };

  // 행 업데이트
  const updateRow = (rowId, field, value) => {
    setRows(rows.map(row => {
      if (row.id === rowId) {
        if (field === 'location') {
          // 로케이션은 포맷팅 적용
          return { ...row, [field]: formatLocation(value) };
        } else if (field === 'quantity') {
          const numValue = parseInt(value) || 0;
          const remainingQuantity = getRemainingQuantity(row.productId);
          const currentQuantity = parseInt(row.quantity) || 0;
          const maxAllowed = remainingQuantity + currentQuantity;
          return { ...row, [field]: Math.min(numValue, maxAllowed).toString() };
        } else if (field === 'expiryDate') {
          // 날짜 형식 처리 (YYYYMMDD 입력 시 자동 변환)
          const cleaned = value.replace(/[^0-9]/g, '');
          if (cleaned.length === 8) {
            const year = cleaned.slice(0, 4);
            const month = cleaned.slice(4, 6);
            const day = cleaned.slice(6, 8);
            return { ...row, [field]: `${year}-${month}-${day}` };
          }
          return { ...row, [field]: value };
        }
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  // 행 위/아래 이동
  const moveRow = (index, direction) => {
    const newRows = [...rows];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex >= 0 && targetIndex < rows.length) {
      [newRows[index], newRows[targetIndex]] = [newRows[targetIndex], newRows[index]];
      setRows(newRows);
    }
  };

  // 방향키 네비게이션 처리
  const handleKeyNavigation = (e, rowIndex, fieldName) => {
    const fields = ['location', 'quantity', 'expiryDate', 'lot'];
    const currentFieldIndex = fields.indexOf(fieldName);
    
    let nextRowIndex = rowIndex;
    let nextFieldIndex = currentFieldIndex;
    
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        nextRowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        break;
      case 'ArrowLeft':
        if (fieldName === 'quantity') {
          // 수량 필드에서는 무조건 이전 필드로 이동
          e.preventDefault();
          nextFieldIndex = Math.max(0, currentFieldIndex - 1);
        } else {
          // 다른 필드에서는 커서가 맨 앞에 있을 때만 이동
          if (e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
            e.preventDefault();
            nextFieldIndex = Math.max(0, currentFieldIndex - 1);
          }
        }
        break;
      case 'ArrowRight':
        if (fieldName === 'quantity') {
          // 수량 필드에서는 무조건 다음 필드로 이동
          e.preventDefault();
          nextFieldIndex = Math.min(fields.length - 1, currentFieldIndex + 1);
        } else {
          // 다른 필드에서는 커서가 맨 끝에 있을 때만 이동
          if (e.target.selectionStart === e.target.value.length && 
              e.target.selectionEnd === e.target.value.length) {
            e.preventDefault();
            nextFieldIndex = Math.min(fields.length - 1, currentFieldIndex + 1);
          }
        }
        break;
      case 'Tab':
        // Tab은 기본 동작 유지 (Shift+Tab은 역방향)
        if (!e.shiftKey) {
          if (currentFieldIndex < fields.length - 1) {
            e.preventDefault();
            nextFieldIndex = currentFieldIndex + 1;
          } else if (rowIndex < rows.length - 1) {
            e.preventDefault();
            nextRowIndex = rowIndex + 1;
            nextFieldIndex = 0;
          }
        } else {
          if (currentFieldIndex > 0) {
            e.preventDefault();
            nextFieldIndex = currentFieldIndex - 1;
          } else if (rowIndex > 0) {
            e.preventDefault();
            nextRowIndex = rowIndex - 1;
            nextFieldIndex = fields.length - 1;
          }
        }
        break;
      default:
        return;
    }
    
    // 다음 입력 필드로 포커스 이동
    if (nextRowIndex !== rowIndex || nextFieldIndex !== currentFieldIndex) {
      const nextField = fields[nextFieldIndex];
      const nextInput = document.querySelector(
        `input[data-row="${nextRowIndex}"][data-field="${nextField}"]`
      );
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  // 클립보드 복사용 데이터 생성
  const generateClipboardData = () => {
    const validRows = rows.filter(row => row.location && row.quantity);
    
    if (validRows.length === 0) {
      alert('복사할 데이터가 없습니다. 로케이션과 수량을 입력해주세요.');
      return '';
    }
    
    const clipboardRows = validRows.map(row => [
      row.barcode,
      '', // 박스번호 (빈값)
      row.location, // 정상다중로케이션 - 실제 입력한 로케이션
      '', // 불량다중로케이션 (빈값)
      row.expiryDate || '',
      row.lot || '',
      row.quantity,
      0 // 불량수량 (고정값 0)
    ].join('\t'));
    
    return clipboardRows.join('\n');
  };

  // 클립보드 복사
  const copyToClipboard = () => {
    const data = generateClipboardData();
    if (!data) return;
    
    navigator.clipboard.writeText(data).then(() => {
      alert('클립보드에 복사되었습니다.');
    }).catch(err => {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    });
  };

  // 제품별 통계 계산
  const getProductStats = () => {
    const stats = {};
    excelData.forEach(product => {
      const assignedQuantity = rows
        .filter(row => row.productId === product.id)
        .reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0);
      
      stats[product.id] = {
        total: product.quantity,
        assigned: assignedQuantity,
        remaining: product.quantity - assignedQuantity
      };
    });
    return stats;
  };

  const productStats = getProductStats();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-full mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">물류 로케이션 배정 시스템</h1>
        
        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-2">엑셀 파일 업로드</h2>
              <p className="text-gray-600 text-sm">2행이 헤더인 엑셀 파일을 업로드하세요.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Upload size={20} />
                파일 선택
              </button>
              {rows.length > 0 && (
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                >
                  <Copy size={20} />
                  클립보드 복사
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* 작업 테이블 */}
        {rows.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">로케이션 배정 작업</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b-2 border-gray-200">
                    <th className="text-left p-3 font-semibold text-sm sticky left-0 bg-gray-100">상품코드</th>
                    <th className="text-left p-3 font-semibold text-sm">상품명</th>
                    <th className="text-left p-3 font-semibold text-sm">바코드</th>
                    <th className="text-center p-3 font-semibold text-sm">예정수량</th>
                    <th className="text-center p-3 font-semibold text-sm">남은수량</th>
                    <th className="text-left p-3 font-semibold text-sm">로케이션</th>
                    <th className="text-center p-3 font-semibold text-sm">수량</th>
                    <th className="text-left p-3 font-semibold text-sm">유통기한</th>
                    <th className="text-left p-3 font-semibold text-sm">LOT</th>
                    <th className="text-center p-3 font-semibold text-sm">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const stats = productStats[row.productId];
                    const isFirstRow = index === 0 || rows[index - 1].productId !== row.productId;
                    const isLastRow = index === rows.length - 1 || rows[index + 1].productId !== row.productId;
                    
                    return (
                      <tr key={row.id} className={`border-b hover:bg-gray-50 ${isLastRow ? 'border-b-2 border-gray-300' : ''}`}>
                        <td className="p-2 sticky left-0 bg-white">{row.productCode}</td>
                        <td className="p-2">{row.productName}</td>
                        <td className="p-2">{row.barcode}</td>
                        <td className="text-center p-2">{row.totalQuantity}</td>
                        <td className={`text-center p-2 font-semibold ${stats.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {stats.remaining}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.location}
                            onChange={(e) => updateRow(row.id, 'location', e.target.value)}
                            onKeyDown={(e) => {
                              // 백스페이스나 Delete 키 처리
                              if (e.key === 'Backspace' || e.key === 'Delete') {
                                const input = e.target;
                                const start = input.selectionStart;
                                const end = input.selectionEnd;
                                
                                // 선택 영역이 없고 커서 앞이 하이픈인 경우
                                if (start === end && start > 0 && row.location[start - 1] === '-') {
                                  e.preventDefault();
                                  // 하이픈과 그 앞 문자를 함께 삭제
                                  const newValue = row.location.slice(0, start - 2) + row.location.slice(start);
                                  updateRow(row.id, 'location', newValue);
                                  
                                  // 커서 위치 조정
                                  setTimeout(() => {
                                    input.selectionStart = input.selectionEnd = start - 2;
                                  }, 0);
                                  return;
                                }
                              }
                              handleKeyNavigation(e, index, 'location');
                            }}
                            data-row={index}
                            data-field="location"
                            placeholder="예: BB121212"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            maxLength={11}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => updateRow(row.id, 'quantity', e.target.value)}
                            onKeyDown={(e) => handleKeyNavigation(e, index, 'quantity')}
                            data-row={index}
                            data-field="quantity"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                            min="0"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.expiryDate}
                            onChange={(e) => updateRow(row.id, 'expiryDate', e.target.value)}
                            onKeyDown={(e) => handleKeyNavigation(e, index, 'expiryDate')}
                            data-row={index}
                            data-field="expiryDate"
                            placeholder="YYYYMMDD 또는 YYYY-MM-DD"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.lot}
                            onChange={(e) => updateRow(row.id, 'lot', e.target.value)}
                            onKeyDown={(e) => handleKeyNavigation(e, index, 'lot')}
                            data-row={index}
                            data-field="lot"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => moveRow(index, 'up')}
                              disabled={index === 0}
                              className="p-1 text-gray-600 hover:text-blue-600 disabled:text-gray-300"
                              title="위로 이동"
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              onClick={() => moveRow(index, 'down')}
                              disabled={index === rows.length - 1}
                              className="p-1 text-gray-600 hover:text-blue-600 disabled:text-gray-300"
                              title="아래로 이동"
                            >
                              <ChevronDown size={16} />
                            </button>
                            <button
                              onClick={() => addRow(row.productId)}
                              className="p-1 text-green-600 hover:text-green-700"
                              title="행 추가"
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              onClick={() => deleteRow(row.id)}
                              className="p-1 text-red-600 hover:text-red-700"
                              title="행 삭제"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 요약 정보 */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold mb-2">배정 요약</h3>
              <div className="grid grid-cols-4 gap-4 text-sm">
                {excelData.map(product => {
                  const stats = productStats[product.id];
                  return (
                    <div key={product.id} className="flex justify-between">
                      <span className="text-gray-600">{product.productCode}:</span>
                      <span className={stats.remaining > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                        {stats.assigned} / {stats.total} (남은수량: {stats.remaining})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocationAssignmentApp;