import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Copy, Undo2, Redo2, HelpCircle, X, CheckCircle, AlertCircle } from 'lucide-react';

const LocationAssignmentApp = () => {
  const [excelData, setExcelData] = useState([]);
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);
  const [notification, setNotification] = useState(null);
  const [focusedRow, setFocusedRow] = useState(null);
  const fileInputRef = useRef(null);

  // 알림 표시
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 2000);
  }, []);

  // 히스토리 저장
  const saveHistory = useCallback((newRows) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(newRows)));
      return newHistory.slice(-50); // 최대 50단계
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setRows(JSON.parse(JSON.stringify(history[historyIndex - 1])));
      showNotification('되돌리기', 'info');
    }
  }, [historyIndex, history, showNotification]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setRows(JSON.parse(JSON.stringify(history[historyIndex + 1])));
      showNotification('다시 실행', 'info');
    }
  }, [historyIndex, history, showNotification]);

  // 엑셀 파일 읽기
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const headers = jsonData[1];
      const dataRows = jsonData.slice(2);
      
      const columnIndexes = {
        productCode: headers.findIndex(h => h && h.toString().includes('상품코드')),
        productName: headers.findIndex(h => h && h.toString().includes('상품명')),
        barcode: headers.findIndex(h => h && h.toString().includes('바코드')),
        erpRequestNo: headers.findIndex(h => h && h.toString().includes('ERP요청순번')),
        quantity: headers.findIndex(h => h && h.toString().includes('예정수량'))
      };
      
      const parsedData = dataRows
        .filter(row => row[columnIndexes.productCode])
        .map((row, index) => ({
          id: index + 1,
          productCode: row[columnIndexes.productCode] || '',
          productName: row[columnIndexes.productName] || '',
          barcode: row[columnIndexes.barcode] || '',
          erpRequestNo: row[columnIndexes.erpRequestNo] || '',
          quantity: parseInt(row[columnIndexes.quantity]) || 0
        }));
      
      setExcelData(parsedData);
      
      const initialRows = parsedData.map(item => ({
        id: `${item.id}-1`,
        productId: item.id,
        productCode: item.productCode,
        productName: item.productName,
        barcode: item.barcode,
        erpRequestNo: item.erpRequestNo,
        totalQuantity: item.quantity,
        location: '',
        quantity: '',
        expiryDate: '',
        lot: ''
      }));
      
      setRows(initialRows);
      setHistory([JSON.parse(JSON.stringify(initialRows))]);
      setHistoryIndex(0);
      showNotification('파일 업로드 완료', 'success');
      
    } catch (error) {
      console.error('파일 읽기 오류:', error);
      showNotification('엑셀 파일을 읽는 중 오류가 발생했습니다.', 'error');
    }
  };

  // 로케이션 포맷팅
  const formatLocation = (value) => {
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const limited = cleaned.slice(0, 8);
    
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

  // 날짜 포맷팅
  const formatDate = (value) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    if (cleaned.length === 8) {
      const year = cleaned.slice(0, 4);
      const month = cleaned.slice(4, 6);
      const day = cleaned.slice(6, 8);
      return `${year}-${month}-${day}`;
    }
    return value;
  };

  // 로케이션 중복 체크
  const checkDuplicateLocation = (location, currentRowId) => {
    if (!location || location === '00-00-00-00') return false;
    return rows.some(row => 
      row.id !== currentRowId && 
      row.location === location && 
      row.location.length === 11
    );
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

  // 행 업데이트 (히스토리 저장 포함)
  const updateRow = useCallback((rowId, field, value) => {
    setRows(prevRows => {
      const newRows = prevRows.map(row => {
        if (row.id === rowId) {
          if (field === 'location') {
            return { ...row, [field]: formatLocation(value) };
          } else if (field === 'quantity') {
            const numValue = parseInt(value) || 0;
            const remainingQuantity = getRemainingQuantity(row.productId);
            const currentQuantity = parseInt(row.quantity) || 0;
            const maxAllowed = remainingQuantity + currentQuantity;
            return { ...row, [field]: Math.min(numValue, maxAllowed).toString() };
          } else if (field === 'expiryDate') {
            return { ...row, [field]: formatDate(value) };
          }
          return { ...row, [field]: value };
        }
        return row;
      });
      saveHistory(newRows);
      return newRows;
    });
  }, [saveHistory]);

  // 행 추가
  const addRow = useCallback((productId, afterRowId = null) => {
    setRows(prevRows => {
      const product = excelData.find(p => p.id === productId);
      if (!product) return prevRows;

      const productRows = prevRows.filter(r => r.productId === productId);
      const newRowNumber = productRows.length + 1;
      
      // 이전 행의 유통기한과 LOT 가져오기
      const lastProductRow = productRows[productRows.length - 1];
      
      const newRow = {
        id: `${productId}-${newRowNumber}`,
        productId: product.id,
        productCode: product.productCode,
        productName: product.productName,
        barcode: product.barcode,
        erpRequestNo: product.erpRequestNo,
        totalQuantity: product.quantity,
        location: '',
        quantity: '',
        expiryDate: lastProductRow?.expiryDate || '',
        lot: lastProductRow?.lot || ''
      };

      const targetIndex = afterRowId 
        ? prevRows.findIndex(r => r.id === afterRowId)
        : prevRows.findLastIndex(r => r.productId === productId);
      
      const newRows = [...prevRows];
      newRows.splice(targetIndex + 1, 0, newRow);
      saveHistory(newRows);
      return newRows;
    });
    showNotification('새 행 추가됨', 'success');
  }, [excelData, saveHistory, showNotification]);

  // 행 복제
  const duplicateRow = useCallback((rowId) => {
    setRows(prevRows => {
      const rowIndex = prevRows.findIndex(r => r.id === rowId);
      if (rowIndex === -1) return prevRows;
      
      const row = prevRows[rowIndex];
      const productRows = prevRows.filter(r => r.productId === row.productId);
      const newRowNumber = productRows.length + 1;
      
      const newRow = {
        ...row,
        id: `${row.productId}-${newRowNumber}`,
        location: '', // 로케이션만 비움
        quantity: ''
      };
      
      const newRows = [...prevRows];
      newRows.splice(rowIndex + 1, 0, newRow);
      saveHistory(newRows);
      return newRows;
    });
    showNotification('행 복제됨 (로케이션 입력 필요)', 'success');
  }, [saveHistory, showNotification]);

  // 행 삭제
  const deleteRow = useCallback((rowId) => {
    setRows(prevRows => {
      const newRows = prevRows.filter(row => row.id !== rowId);
      saveHistory(newRows);
      return newRows;
    });
    showNotification('행 삭제됨', 'info');
  }, [saveHistory, showNotification]);

  // 행 이동
  const moveRow = useCallback((rowId, direction) => {
    setRows(prevRows => {
      const index = prevRows.findIndex(r => r.id === rowId);
      if (index === -1) return prevRows;
      
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      
      if (targetIndex >= 0 && targetIndex < prevRows.length) {
        const newRows = [...prevRows];
        [newRows[index], newRows[targetIndex]] = [newRows[targetIndex], newRows[index]];
        saveHistory(newRows);
        return newRows;
      }
      return prevRows;
    });
  }, [saveHistory]);

  // 클립보드 복사
  const copyToClipboard = useCallback(() => {
    const validRows = rows.filter(row => row.location && row.quantity);
    
    if (validRows.length === 0) {
      showNotification('복사할 데이터가 없습니다. 로케이션과 수량을 입력해주세요.', 'error');
      return;
    }
    
    const clipboardRows = validRows.map(row => [
      row.barcode,
      row.erpRequestNo || '',
      row.location,
      row.expiryDate || '',
      row.lot || '',
      row.quantity
    ].join('\t'));
    
    const data = clipboardRows.join('\n');
    
    navigator.clipboard.writeText(data).then(() => {
      showNotification(`${validRows.length}개 행이 클립보드에 복사되었습니다.`, 'success');
    }).catch(err => {
      console.error('복사 실패:', err);
      showNotification('복사에 실패했습니다.', 'error');
    });
  }, [rows, showNotification]);

  // 전역 키보드 이벤트
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Ctrl/Cmd 조합키만 전역 처리
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;
      
      if (!ctrlKey) return;

      // Ctrl+Z: Undo
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y 또는 Ctrl+Shift+Z: Redo
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+S: 클립보드 복사
      if (e.key === 's') {
        e.preventDefault();
        copyToClipboard();
        return;
      }

      // Ctrl+D: 행 복제
      if (e.key === 'd' && focusedRow) {
        e.preventDefault();
        duplicateRow(focusedRow);
        return;
      }

      // Ctrl+Enter: 새 행 추가
      if (e.key === 'Enter' && focusedRow) {
        e.preventDefault();
        const row = rows.find(r => r.id === focusedRow);
        if (row) {
          addRow(row.productId, focusedRow);
        }
        return;
      }

      // Ctrl+Shift+Delete: 행 삭제
      if (e.key === 'Delete' && e.shiftKey && focusedRow) {
        e.preventDefault();
        deleteRow(focusedRow);
        return;
      }

      // Ctrl+Shift+↑/↓: 행 이동
      if (e.shiftKey && focusedRow) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveRow(focusedRow, 'up');
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveRow(focusedRow, 'down');
          return;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [undo, redo, copyToClipboard, duplicateRow, addRow, deleteRow, moveRow, focusedRow, rows]);

  // 방향키 네비게이션
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
        e.preventDefault();
        nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        break;
      case 'Enter':
        if (!e.ctrlKey) {
          e.preventDefault();
          nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        }
        break;
      case 'ArrowLeft':
        if (fieldName === 'quantity' || 
            (e.target.selectionStart === 0 && e.target.selectionEnd === 0)) {
          e.preventDefault();
          nextFieldIndex = Math.max(0, currentFieldIndex - 1);
        }
        break;
      case 'ArrowRight':
        if (fieldName === 'quantity' ||
            (e.target.selectionStart === e.target.value.length && 
             e.target.selectionEnd === e.target.value.length)) {
          e.preventDefault();
          nextFieldIndex = Math.min(fields.length - 1, currentFieldIndex + 1);
        }
        break;
      case 'Tab':
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

  // 제품별 통계
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
      {/* 알림 */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in ${
          notification.type === 'success' ? 'bg-green-500 text-white' :
          notification.type === 'error' ? 'bg-red-500 text-white' :
          'bg-blue-500 text-white'
        }`}>
          {notification.type === 'success' && <CheckCircle size={20} />}
          {notification.type === 'error' && <AlertCircle size={20} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 도움말 모달 */}
      {showHelp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
              <h3 className="text-xl font-bold">키보드 단축키</h3>
              <button onClick={() => setShowHelp(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-lg">기본 네비게이션</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono">↑ ↓</span>
                    <span>위/아래 행 이동</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono">← →</span>
                    <span>좌/우 필드 이동</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono">Tab</span>
                    <span>다음 필드</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono">Shift+Tab</span>
                    <span>이전 필드</span>
                  </div>
                  <div className="flex justify-between p-2 bg-gray-50 rounded">
                    <span className="font-mono">Enter</span>
                    <span>다음 행으로</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-lg">행 편집</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between p-2 bg-blue-50 rounded">
                    <span className="font-mono">Ctrl+D</span>
                    <span>현재 행 복제</span>
                  </div>
                  <div className="flex justify-between p-2 bg-blue-50 rounded">
                    <span className="font-mono">Ctrl+Enter</span>
                    <span>새 행 추가</span>
                  </div>
                  <div className="flex justify-between p-2 bg-blue-50 rounded">
                    <span className="font-mono">Ctrl+Shift+Del</span>
                    <span>현재 행 삭제</span>
                  </div>
                  <div className="flex justify-between p-2 bg-blue-50 rounded">
                    <span className="font-mono">Ctrl+Shift+↑↓</span>
                    <span>행 이동</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-lg">작업 관리</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between p-2 bg-green-50 rounded">
                    <span className="font-mono">Ctrl+Z</span>
                    <span>되돌리기</span>
                  </div>
                  <div className="flex justify-between p-2 bg-green-50 rounded">
                    <span className="font-mono">Ctrl+Y</span>
                    <span>다시 실행</span>
                  </div>
                  <div className="flex justify-between p-2 bg-green-50 rounded">
                    <span className="font-mono">Ctrl+S</span>
                    <span>클립보드 복사</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-lg">입력 규칙</h4>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li><strong>로케이션:</strong> 8자리 자동 포맷 (예: BB121212 → BB-12-12-12)</li>
                  <li><strong>유통기한:</strong> YYYYMMDD 입력 시 자동 포맷 (예: 20251231 → 2025-12-31)</li>
                  <li><strong>수량:</strong> 남은 수량을 초과할 수 없음</li>
                  <li><strong>행 복제:</strong> 유통기한/LOT는 복사되지만 로케이션은 비워짐</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">물류 로케이션 배정 시스템</h1>
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
          >
            <HelpCircle size={20} />
            <span className="text-sm">단축키 도움말</span>
          </button>
        </div>
        
        {/* 파일 업로드 & 액션 버튼 */}
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
                <>
                  <button
                    onClick={undo}
                    disabled={historyIndex <= 0}
                    className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Ctrl+Z"
                  >
                    <Undo2 size={20} />
                    되돌리기
                  </button>
                  <button
                    onClick={redo}
                    disabled={historyIndex >= history.length - 1}
                    className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Ctrl+Y"
                  >
                    <Redo2 size={20} />
                    다시 실행
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                    title="Ctrl+S"
                  >
                    <Copy size={20} />
                    클립보드 복사
                  </button>
                </>
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
                    <th className="text-left p-3 font-semibold text-sm sticky left-0 bg-gray-100 z-10">상품코드</th>
                    <th className="text-left p-3 font-semibold text-sm">상품명</th>
                    <th className="text-left p-3 font-semibold text-sm">바코드</th>
                    <th className="text-left p-3 font-semibold text-sm">ERP요청순번</th>
                    <th className="text-center p-3 font-semibold text-sm">예정수량</th>
                    <th className="text-center p-3 font-semibold text-sm">남은수량</th>
                    <th className="text-left p-3 font-semibold text-sm">로케이션</th>
                    <th className="text-center p-3 font-semibold text-sm">수량</th>
                    <th className="text-left p-3 font-semibold text-sm">유통기한</th>
                    <th className="text-left p-3 font-semibold text-sm">LOT</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const stats = productStats[row.productId];
                    const isLastRow = index === rows.length - 1 || rows[index + 1].productId !== row.productId;
                    const isDuplicateLocation = checkDuplicateLocation(row.location, row.id);
                    
                    return (
                      <tr 
                        key={row.id} 
                        className={`border-b hover:bg-blue-50 transition-colors ${
                          isLastRow ? 'border-b-2 border-gray-300' : ''
                        } ${focusedRow === row.id ? 'bg-blue-50' : ''}`}
                      >
                        <td className="p-2 sticky left-0 bg-white z-10">{row.productCode}</td>
                        <td className="p-2 max-w-xs truncate" title={row.productName}>{row.productName}</td>
                        <td className="p-2">{row.barcode}</td>
                        <td className="p-2">{row.erpRequestNo}</td>
                        <td className="text-center p-2">{row.totalQuantity.toLocaleString()}</td>
                        <td className={`text-center p-2 font-semibold ${
                          stats.remaining < 0 ? 'text-white bg-red-600' : 
                          stats.remaining > 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {stats.remaining.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.location}
                            onChange={(e) => updateRow(row.id, 'location', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Backspace' || e.key === 'Delete') {
                                const input = e.target;
                                const start = input.selectionStart;
                                const end = input.selectionEnd;
                                
                                if (start === end && start > 0 && row.location[start - 1] === '-') {
                                  e.preventDefault();
                                  const newValue = row.location.slice(0, start - 2) + row.location.slice(start);
                                  updateRow(row.id, 'location', newValue);
                                  setTimeout(() => {
                                    input.selectionStart = input.selectionEnd = start - 2;
                                  }, 0);
                                  return;
                                }
                              }
                              handleKeyNavigation(e, index, 'location');
                            }}
                            onFocus={() => setFocusedRow(row.id)}
                            data-row={index}
                            data-field="location"
                            placeholder="예: BB121212"
                            className={`w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 ${
                              isDuplicateLocation 
                                ? 'border-red-500 focus:ring-red-500 bg-red-50' 
                                : 'focus:ring-blue-500'
                            }`}
                            maxLength={11}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => updateRow(row.id, 'quantity', e.target.value)}
                            onKeyDown={(e) => handleKeyNavigation(e, index, 'quantity')}
                            onFocus={() => setFocusedRow(row.id)}
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
                            onFocus={() => setFocusedRow(row.id)}
                            data-row={index}
                            data-field="expiryDate"
                            placeholder="YYYYMMDD"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.lot}
                            onChange={(e) => updateRow(row.id, 'lot', e.target.value)}
                            onKeyDown={(e) => handleKeyNavigation(e, index, 'lot')}
                            onFocus={() => setFocusedRow(row.id)}
                            data-row={index}
                            data-field="lot"
                            className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {excelData.map(product => {
                  const stats = productStats[product.id];
                  return (
                    <div key={product.id} className="flex justify-between">
                      <span className="text-gray-600">{product.productCode}:</span>
                      <span className={stats.remaining > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                        {stats.assigned.toLocaleString()} / {stats.total.toLocaleString()}
                        <span className="text-xs ml-1">
                          (남음: {stats.remaining.toLocaleString()})
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 하단 단축키 힌트 */}
            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-gray-700">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span><kbd className="px-2 py-1 bg-white rounded shadow">Ctrl+D</kbd> 행복제</span>
                <span><kbd className="px-2 py-1 bg-white rounded shadow">Ctrl+Enter</kbd> 행추가</span>
                <span><kbd className="px-2 py-1 bg-white rounded shadow">Ctrl+Z</kbd> 되돌리기</span>
                <span><kbd className="px-2 py-1 bg-white rounded shadow">Ctrl+S</kbd> 복사</span>
                <span><kbd className="px-2 py-1 bg-white rounded shadow">?</kbd> 전체 단축키 보기</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        kbd {
          font-family: monospace;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
};

export default LocationAssignmentApp;