import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import Head from 'next/head';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../_app';

export default function PrismWarehouse() {
  const router = useRouter();
  const { isLoggedIn, loading: authLoading, isAdmin, isPrism, userName, logout, role } = useAuth();

  // 우리(admin/office) vs 프리즘(prism) 구분
  const isOurSide = isAdmin || role === 'office';
  const isPrismSide = isPrism;

  const [activeTab, setActiveTab] = useState(null);
  const [file, setFile] = useState(null);
  const [transactionDate, setTransactionDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [outboundRequests, setOutboundRequests] = useState([]);
  const [outboundLoading, setOutboundLoading] = useState(false);

  const [inboundHistory, setInboundHistory] = useState([]);
  const [inboundLoading, setInboundLoading] = useState(false);

  const [currentStock, setCurrentStock] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);

  // 초기 탭 설정
  useEffect(() => {
    if (!authLoading && isLoggedIn) {
      if (isPrismSide) {
        setActiveTab('inbound'); // 프리즘: 입고 등록이 기본
      } else if (isOurSide) {
        setActiveTab('outbound_request'); // 우리: 출고 요청이 기본
      }
    }
  }, [authLoading, isLoggedIn, isPrismSide, isOurSide]);

  // 엑셀 파일 읽기
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

  // 엑셀 날짜 변환
  const parseExcelDate = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
      return null;
    }
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    return null;
  };

  // 보관일수 계산
  const calculateStorageDays = (firstInDate) => {
    if (!firstInDate) return 0;
    const today = new Date();
    const inDate = new Date(firstInDate);
    const diffTime = today.getTime() - inDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  // 파일 선택 시 미리보기
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError(null);
    setSuccess(null);
    setPreviewData(null);

    if (!selectedFile) return;

    try {
      const data = await readExcelFile(selectedFile);
      if (data.length < 2) {
        setError('파일에 데이터가 충분하지 않습니다.');
        return;
      }

      let headerIdx = -1;
      let headers = [];

      for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('상품코드') || rowStr.includes('번호')) {
          headerIdx = i;
          headers = row;
          break;
        }
      }

      if (headerIdx === -1) {
        headerIdx = data[0] && data[0].length > 3 ? 0 : 1;
        headers = data[headerIdx] || [];
      }

      const findCol = (names) => {
        for (const name of names) {
          const idx = headers.findIndex(h => h && h.toString().toLowerCase().includes(name.toLowerCase()));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const productCodeIdx = findCol(['상품코드']);
      const productNameIdx = findCol(['상품명']);
      const lotIdx = findCol(['lot', 'LOT']);
      const expiryIdx = findCol(['유통기한']);
      const qtyIdx = findCol(['수량', '정상수량']);
      const locationIdx = findCol(['로케이션', '다중로케이션']);

      const items = [];
      for (let i = headerIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const productCode = productCodeIdx !== -1 ? String(row[productCodeIdx] || '').trim() : '';
        if (!productCode) continue;

        const qty = qtyIdx !== -1 ? (parseFloat(row[qtyIdx]) || 0) : 0;
        if (qty <= 0) continue;

        items.push({
          product_code: productCode,
          product_name: productNameIdx !== -1 ? String(row[productNameIdx] || '').trim() : '',
          lot: lotIdx !== -1 ? String(row[lotIdx] || '').trim() : '',
          expiry_date: expiryIdx !== -1 ? parseExcelDate(row[expiryIdx]) : null,
          quantity: qty,
          location: locationIdx !== -1 ? String(row[locationIdx] || '').trim() : ''
        });
      }

      if (items.length === 0) {
        setError('유효한 데이터가 없습니다.');
        return;
      }

      setPreviewData({
        items,
        fileName: selectedFile.name,
        totalQty: items.reduce((sum, item) => sum + item.quantity, 0)
      });
    } catch (err) {
      setError(`파일 읽기 오류: ${err.message}`);
    }
  };

  // 입고 저장 (프리즘 전용)
  const handleSaveInbound = async () => {
    if (!previewData || previewData.items.length === 0) {
      setError('저장할 데이터가 없습니다.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const records = previewData.items.map(item => ({
        transaction_date: transactionDate,
        type: 'in',
        product_code: item.product_code,
        product_name: item.product_name,
        lot: item.lot || null,
        expiry_date: item.expiry_date || null,
        quantity: item.quantity,
        location: item.location || null,
        file_name: previewData.fileName,
        status: 'completed'
      }));

      const { error: insertError } = await supabase
        .from('prism_inventory')
        .insert(records);

      if (insertError) throw insertError;

      setSuccess(`${records.length}건 입고 완료! (총 ${previewData.totalQty.toLocaleString()}개)`);
      setFile(null);
      setPreviewData(null);

      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setError(`저장 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 출고 요청 저장 (우리 전용)
  const handleSaveOutboundRequest = async () => {
    if (!previewData || previewData.items.length === 0) {
      setError('저장할 데이터가 없습니다.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const records = previewData.items.map(item => ({
        transaction_date: transactionDate,
        type: 'out',
        product_code: item.product_code,
        product_name: item.product_name,
        lot: item.lot || null,
        expiry_date: item.expiry_date || null,
        quantity: item.quantity,
        location: item.location || null,
        file_name: previewData.fileName,
        status: 'requested'
      }));

      const { error: insertError } = await supabase
        .from('prism_inventory')
        .insert(records);

      if (insertError) throw insertError;

      setSuccess(`${records.length}건 출고 요청 완료!`);
      setFile(null);
      setPreviewData(null);

      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = '';
    } catch (err) {
      setError(`저장 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 출고 요청 목록 조회 (프리즘: 처리해야 할 것 / 우리: 요청한 것)
  const fetchOutboundRequests = async () => {
    setOutboundLoading(true);
    try {
      let query = supabase
        .from('prism_inventory')
        .select('*')
        .eq('type', 'out')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      // 프리즘은 미완료 건만, 우리는 전체
      if (isPrismSide) {
        query = query.neq('status', 'completed');
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setOutboundRequests(data || []);
    } catch (err) {
      setError(`조회 오류: ${err.message}`);
    } finally {
      setOutboundLoading(false);
    }
  };

  // 입고 이력 조회
  const fetchInboundHistory = async () => {
    setInboundLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('prism_inventory')
        .select('*')
        .eq('type', 'in')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (fetchError) throw fetchError;
      setInboundHistory(data || []);
    } catch (err) {
      setError(`조회 오류: ${err.message}`);
    } finally {
      setInboundLoading(false);
    }
  };

  // 현재고 조회
  const fetchCurrentStock = async () => {
    setStockLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('prism_inventory')
        .select('*')
        .eq('status', 'completed');

      if (fetchError) throw fetchError;

      const stockMap = {};
      (data || []).forEach(item => {
        const key = `${item.product_code}|${item.lot || ''}|${item.expiry_date || ''}|${item.location || ''}`;
        if (!stockMap[key]) {
          stockMap[key] = {
            product_code: item.product_code,
            product_name: item.product_name,
            lot: item.lot,
            expiry_date: item.expiry_date,
            location: item.location,
            quantity: 0,
            first_in_date: null
          };
        }
        if (item.type === 'in') {
          stockMap[key].quantity += item.quantity;
          if (!stockMap[key].first_in_date || item.transaction_date < stockMap[key].first_in_date) {
            stockMap[key].first_in_date = item.transaction_date;
          }
        } else {
          stockMap[key].quantity -= item.quantity;
        }
      });

      const stockList = Object.values(stockMap)
        .filter(item => item.quantity > 0)
        .map(item => ({
          ...item,
          storage_days: calculateStorageDays(item.first_in_date)
        }))
        .sort((a, b) => b.storage_days - a.storage_days);

      setCurrentStock(stockList);
    } catch (err) {
      setError(`조회 오류: ${err.message}`);
    } finally {
      setStockLoading(false);
    }
  };

  // 출고 상태 변경 (프리즘 전용)
  const updateOutboundStatus = async (id, newStatus) => {
    try {
      const { error: updateError } = await supabase
        .from('prism_inventory')
        .update({ status: newStatus })
        .eq('id', id);

      if (updateError) throw updateError;

      if (newStatus === 'completed') {
        setOutboundRequests(prev => prev.filter(item => item.id !== id));
      } else {
        fetchOutboundRequests();
      }
    } catch (err) {
      setError(`상태 변경 오류: ${err.message}`);
    }
  };

  // 권한 체크
  useEffect(() => {
    if (!authLoading && isLoggedIn) {
      if (!isAdmin && !isPrism && role !== 'office') {
        router.push('/');
      }
    } else if (!authLoading && !isLoggedIn) {
      router.push('/login');
    }
  }, [authLoading, isLoggedIn, isAdmin, isPrism, role, router]);

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (!activeTab) return;

    if (activeTab === 'outbound_list' || activeTab === 'outbound_request') {
      fetchOutboundRequests();
    } else if (activeTab === 'inbound_history') {
      fetchInboundHistory();
    } else if (activeTab === 'stock') {
      fetchCurrentStock();
    }
  }, [activeTab]);

  const getStatusLabel = (status) => {
    switch (status) {
      case 'requested': return { text: '요청', bg: 'bg-amber-500' };
      case 'ready': return { text: '준비완료', bg: 'bg-blue-500' };
      case 'in_progress': return { text: '진행중', bg: 'bg-violet-500' };
      case 'completed': return { text: '완료', bg: 'bg-emerald-500' };
      default: return { text: status, bg: 'bg-gray-500' };
    }
  };

  if (authLoading || !isLoggedIn || (!isAdmin && !isPrism && role !== 'office')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Head><title>프리즘창고</title></Head>
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }

  // 프리즘용 탭
  const prismTabs = [
    { id: 'inbound', label: '입고 등록' },
    { id: 'outbound_list', label: '출고 요청', badge: outboundRequests.filter(r => r.status !== 'completed').length },
    { id: 'stock', label: '재고 현황' },
  ];

  // 우리용 탭
  const ourTabs = [
    { id: 'outbound_request', label: '출고 요청' },
    { id: 'outbound_list', label: '요청 현황' },
    { id: 'inbound_history', label: '입고 이력' },
    { id: 'stock', label: '재고 현황' },
  ];

  const tabs = isPrismSide ? prismTabs : ourTabs;

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Head><title>프리즘창고</title></Head>

      {/* 헤더 */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg flex items-center justify-center font-bold text-lg">
              P
            </div>
            <div>
              <h1 className="font-bold text-lg">프리즘창고</h1>
              <p className="text-xs text-slate-400">
                {isPrismSide ? '외부창고 관리' : '출고 요청 관리'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{userName || '사용자'}</p>
              <p className="text-xs text-slate-400">
                {isPrismSide ? '프리즘창고' : '물류센터'}
              </p>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 탭 */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-cyan-400 border-b-2 border-cyan-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
                {tab.badge > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 rounded-full">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 알림 */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">✕</button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-300 text-sm flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-emerald-300">✕</button>
          </div>
        )}

        {/* 입고 등록 (프리즘 전용) */}
        {activeTab === 'inbound' && isPrismSide && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">입고 등록</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">입고 일자</label>
                  <input
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">엑셀 파일</label>
                  <input
                    type="file"
                    accept=".xls,.xlsx"
                    onChange={handleFileChange}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-500 file:text-white file:text-sm"
                  />
                </div>
              </div>
            </div>

            {previewData && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">미리보기</h3>
                    <p className="text-sm text-slate-400">{previewData.items.length}건 · {previewData.totalQty.toLocaleString()}개</p>
                  </div>
                  <button
                    onClick={handleSaveInbound}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${loading ? 'bg-slate-600' : 'bg-cyan-500 hover:bg-cyan-400'}`}
                  >
                    {loading ? '저장 중...' : '입고 등록'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-400">상품코드</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품명</th>
                        <th className="px-3 py-2 text-left text-slate-400">LOT</th>
                        <th className="px-3 py-2 text-right text-slate-400">수량</th>
                        <th className="px-3 py-2 text-left text-slate-400">로케이션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.items.slice(0, 30).map((item, idx) => (
                        <tr key={idx} className="border-t border-slate-700">
                          <td className="px-3 py-2 font-mono text-xs">{item.product_code}</td>
                          <td className="px-3 py-2">{item.product_name}</td>
                          <td className="px-3 py-2 text-slate-400">{item.lot}</td>
                          <td className="px-3 py-2 text-right">{item.quantity.toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-400">{item.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewData.items.length > 30 && (
                    <p className="text-center py-2 text-slate-500 text-sm">...외 {previewData.items.length - 30}건</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 출고 요청 등록 (우리 전용) */}
        {activeTab === 'outbound_request' && isOurSide && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">출고 요청</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">요청 일자</label>
                  <input
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">엑셀 파일</label>
                  <input
                    type="file"
                    accept=".xls,.xlsx"
                    onChange={handleFileChange}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-500 file:text-white file:text-sm"
                  />
                </div>
              </div>
            </div>

            {previewData && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">미리보기</h3>
                    <p className="text-sm text-slate-400">{previewData.items.length}건 · {previewData.totalQty.toLocaleString()}개</p>
                  </div>
                  <button
                    onClick={handleSaveOutboundRequest}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${loading ? 'bg-slate-600' : 'bg-amber-500 hover:bg-amber-400 text-slate-900'}`}
                  >
                    {loading ? '요청 중...' : '출고 요청'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-400">상품코드</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품명</th>
                        <th className="px-3 py-2 text-left text-slate-400">LOT</th>
                        <th className="px-3 py-2 text-right text-slate-400">수량</th>
                        <th className="px-3 py-2 text-left text-slate-400">로케이션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.items.slice(0, 30).map((item, idx) => (
                        <tr key={idx} className="border-t border-slate-700">
                          <td className="px-3 py-2 font-mono text-xs">{item.product_code}</td>
                          <td className="px-3 py-2">{item.product_name}</td>
                          <td className="px-3 py-2 text-slate-400">{item.lot}</td>
                          <td className="px-3 py-2 text-right">{item.quantity.toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-400">{item.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 출고 요청 목록 */}
        {activeTab === 'outbound_list' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {isPrismSide ? '처리할 출고 요청' : '출고 요청 현황'}
              </h2>
              <button
                onClick={fetchOutboundRequests}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                새로고침
              </button>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              {outboundLoading ? (
                <div className="text-center py-12 text-slate-400">조회 중...</div>
              ) : outboundRequests.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  {isPrismSide ? '처리할 출고 요청이 없습니다.' : '출고 요청 내역이 없습니다.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-400">요청일</th>
                        <th className="px-3 py-2 text-left text-slate-400">상태</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품코드</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품명</th>
                        <th className="px-3 py-2 text-right text-slate-400">수량</th>
                        <th className="px-3 py-2 text-left text-slate-400">로케이션</th>
                        {isPrismSide && <th className="px-3 py-2 text-center text-slate-400">처리</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {outboundRequests.map((item) => {
                        const status = getStatusLabel(item.status);
                        return (
                          <tr key={item.id} className="border-t border-slate-700 hover:bg-slate-700/30">
                            <td className="px-3 py-2">{item.transaction_date}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs text-white ${status.bg}`}>
                                {status.text}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{item.product_code}</td>
                            <td className="px-3 py-2">{item.product_name}</td>
                            <td className="px-3 py-2 text-right">{item.quantity?.toLocaleString()}</td>
                            <td className="px-3 py-2 text-slate-400">{item.location}</td>
                            {isPrismSide && (
                              <td className="px-3 py-2">
                                <div className="flex gap-1 justify-center">
                                  {item.status === 'requested' && (
                                    <button
                                      onClick={() => updateOutboundStatus(item.id, 'ready')}
                                      className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs hover:bg-blue-500/30"
                                    >
                                      준비완료
                                    </button>
                                  )}
                                  {item.status === 'ready' && (
                                    <button
                                      onClick={() => updateOutboundStatus(item.id, 'in_progress')}
                                      className="px-2 py-1 bg-violet-500/20 text-violet-400 rounded text-xs hover:bg-violet-500/30"
                                    >
                                      진행중
                                    </button>
                                  )}
                                  {(item.status === 'ready' || item.status === 'in_progress') && (
                                    <button
                                      onClick={() => updateOutboundStatus(item.id, 'completed')}
                                      className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs hover:bg-emerald-500/30"
                                    >
                                      완료
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 입고 이력 (우리만) */}
        {activeTab === 'inbound_history' && isOurSide && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">입고 이력</h2>
              <button
                onClick={fetchInboundHistory}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                새로고침
              </button>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              {inboundLoading ? (
                <div className="text-center py-12 text-slate-400">조회 중...</div>
              ) : inboundHistory.length === 0 ? (
                <div className="text-center py-12 text-slate-400">입고 이력이 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-400">입고일</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품코드</th>
                        <th className="px-3 py-2 text-left text-slate-400">상품명</th>
                        <th className="px-3 py-2 text-left text-slate-400">LOT</th>
                        <th className="px-3 py-2 text-right text-slate-400">수량</th>
                        <th className="px-3 py-2 text-left text-slate-400">로케이션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboundHistory.map((item) => (
                        <tr key={item.id} className="border-t border-slate-700 hover:bg-slate-700/30">
                          <td className="px-3 py-2">{item.transaction_date}</td>
                          <td className="px-3 py-2 font-mono text-xs">{item.product_code}</td>
                          <td className="px-3 py-2">{item.product_name}</td>
                          <td className="px-3 py-2 text-slate-400">{item.lot}</td>
                          <td className="px-3 py-2 text-right">{item.quantity?.toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-400">{item.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 재고 현황 */}
        {activeTab === 'stock' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">재고 현황</h2>
                <p className="text-sm text-slate-400">프리즘창고 현재 보관 재고</p>
              </div>
              <button
                onClick={fetchCurrentStock}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                새로고침
              </button>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              {stockLoading ? (
                <div className="text-center py-12 text-slate-400">조회 중...</div>
              ) : currentStock.length === 0 ? (
                <div className="text-center py-12 text-slate-400">재고가 없습니다.</div>
              ) : (
                <>
                  <div className="px-4 py-3 bg-slate-700/30 border-b border-slate-700">
                    <span className="text-sm text-slate-400">
                      총 {currentStock.length}건 · {currentStock.reduce((s, i) => s + i.quantity, 0).toLocaleString()}개
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-700/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-400">상품코드</th>
                          <th className="px-3 py-2 text-left text-slate-400">상품명</th>
                          <th className="px-3 py-2 text-left text-slate-400">LOT</th>
                          <th className="px-3 py-2 text-left text-slate-400">유통기한</th>
                          <th className="px-3 py-2 text-right text-slate-400">수량</th>
                          <th className="px-3 py-2 text-left text-slate-400">로케이션</th>
                          <th className="px-3 py-2 text-center text-slate-400">보관일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentStock.map((item, idx) => (
                          <tr key={idx} className={`border-t border-slate-700 ${item.storage_days >= 30 ? 'bg-amber-500/10' : ''}`}>
                            <td className="px-3 py-2 font-mono text-xs">{item.product_code}</td>
                            <td className="px-3 py-2">{item.product_name}</td>
                            <td className="px-3 py-2 text-slate-400">{item.lot}</td>
                            <td className="px-3 py-2 text-slate-400">{item.expiry_date}</td>
                            <td className="px-3 py-2 text-right font-medium">{item.quantity.toLocaleString()}</td>
                            <td className="px-3 py-2 text-slate-400">{item.location}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                item.storage_days >= 60 ? 'bg-red-500/20 text-red-400' :
                                item.storage_days >= 30 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-slate-600 text-slate-400'
                              }`}>
                                {item.storage_days}일
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
