// pages/box-update.js
import { useState } from 'react';
import Head from 'next/head';
import AuthLayout from '@/components/AuthLayout';
import supabase from '@/lib/supabase';
import { useAuth } from '@/pages/_app';

export default function BoxUpdate() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('both'); // 'eabox', 'weight', or 'both'

  // EA/BOX 관련 상태
  const [eaBoxText, setEaBoxText] = useState('');
  const [eaBoxProcessing, setEaBoxProcessing] = useState(false);
  const [eaBoxError, setEaBoxError] = useState('');
  const [eaBoxSuccess, setEaBoxSuccess] = useState(false);
  const [eaBoxUpdatedItems, setEaBoxUpdatedItems] = useState([]);

  // 무게 관련 상태
  const [weightText, setWeightText] = useState('');
  const [weightProcessing, setWeightProcessing] = useState(false);
  const [weightError, setWeightError] = useState('');
  const [weightSuccess, setWeightSuccess] = useState(false);
  const [weightUpdatedItems, setWeightUpdatedItems] = useState([]);

  // 동시 입력 관련 상태
  const [bothText, setBothText] = useState('');
  const [bothProcessing, setBothProcessing] = useState(false);
  const [bothError, setBothError] = useState('');
  const [bothSuccess, setBothSuccess] = useState(false);
  const [bothUpdatedItems, setBothUpdatedItems] = useState([]);

  // 이력 조회 관련 상태
  const [historyModal, setHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyProductCode, setHistoryProductCode] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

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

  // EA/BOX 업데이트 함수
  const updateEaBox = async (e) => {
    e.preventDefault();

    try {
      setEaBoxProcessing(true);
      setEaBoxError('');
      setEaBoxSuccess(false);
      setEaBoxUpdatedItems([]);

      const lines = eaBoxText.split('\n').filter(line => line.trim() !== '');
      const updates = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const productCode = parts[0];
          const eaPerBox = parseFloat(parts[1]);

          if (productCode && !isNaN(eaPerBox)) {
            updates.push({ productCode, eaPerBox });
          }
        }
      }

      if (updates.length === 0) {
        setEaBoxError('유효한 데이터가 없습니다. 형식: 상품코드 EA/BOX');
        setEaBoxProcessing(false);
        return;
      }

      const updatedList = [];

      for (const update of updates) {
        const { data: currentData } = await supabase
          .from('products')
          .select('product_code, product_name, ea_per_box')
          .eq('product_code', update.productCode)
          .single();

        const oldValue = currentData?.ea_per_box;
        const productName = currentData?.product_name || '';

        const { error } = await supabase
          .from('products')
          .update({ ea_per_box: update.eaPerBox })
          .eq('product_code', update.productCode);

        if (error) {
          updatedList.push({
            productCode: update.productCode,
            productName,
            oldValue,
            newValue: update.eaPerBox,
            status: '실패',
            error: error.message
          });
        } else {
          await supabase.from('product_history').insert({
            product_code: update.productCode,
            ea_per_box: update.eaPerBox,
            changed_by: user?.email || 'unknown',
            source: 'EA/BOX 관리'
          });

          updatedList.push({
            productCode: update.productCode,
            productName,
            oldValue,
            newValue: update.eaPerBox,
            status: '성공'
          });
        }
      }

      setEaBoxUpdatedItems(updatedList);
      setEaBoxSuccess(true);

    } catch (err) {
      console.error('EA/BOX 업데이트 오류:', err);
      setEaBoxError('업데이트 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setEaBoxProcessing(false);
    }
  };

  // 무게 업데이트 함수
  const updateWeight = async (e) => {
    e.preventDefault();

    try {
      setWeightProcessing(true);
      setWeightError('');
      setWeightSuccess(false);
      setWeightUpdatedItems([]);

      const lines = weightText.split('\n').filter(line => line.trim() !== '');
      const updates = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const productCode = parts[0];
          const weightPerBox = parseFloat(parts[1]);

          if (productCode && !isNaN(weightPerBox)) {
            updates.push({ productCode, weightPerBox });
          }
        }
      }

      if (updates.length === 0) {
        setWeightError('유효한 데이터가 없습니다. 형식: 상품코드 박스당중량(kg)');
        setWeightProcessing(false);
        return;
      }

      const updatedList = [];

      for (const update of updates) {
        const { data: currentData } = await supabase
          .from('products')
          .select('product_code, product_name, weight_per_box')
          .eq('product_code', update.productCode)
          .single();

        const oldValue = currentData?.weight_per_box;
        const productName = currentData?.product_name || '';

        const { error } = await supabase
          .from('products')
          .update({ weight_per_box: update.weightPerBox })
          .eq('product_code', update.productCode);

        if (error) {
          updatedList.push({
            productCode: update.productCode,
            productName,
            oldValue,
            newValue: update.weightPerBox,
            status: '실패',
            error: error.message
          });
        } else {
          await supabase.from('product_history').insert({
            product_code: update.productCode,
            weight_per_box: update.weightPerBox,
            changed_by: user?.email || 'unknown',
            source: 'EA/BOX 관리'
          });

          updatedList.push({
            productCode: update.productCode,
            productName,
            oldValue,
            newValue: update.weightPerBox,
            status: '성공'
          });
        }
      }

      setWeightUpdatedItems(updatedList);
      setWeightSuccess(true);

    } catch (err) {
      console.error('무게 업데이트 오류:', err);
      setWeightError('업데이트 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setWeightProcessing(false);
    }
  };

  // EA/BOX + 무게 동시 업데이트 함수
  const updateBoth = async (e) => {
    e.preventDefault();

    try {
      setBothProcessing(true);
      setBothError('');
      setBothSuccess(false);
      setBothUpdatedItems([]);

      const lines = bothText.split('\n').filter(line => line.trim() !== '');
      const updates = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const productCode = parts[0];
          const eaPerBox = parseFloat(parts[1]);
          const weightPerBox = parseFloat(parts[2]);

          if (productCode && !isNaN(eaPerBox) && !isNaN(weightPerBox)) {
            updates.push({ productCode, eaPerBox, weightPerBox });
          }
        }
      }

      if (updates.length === 0) {
        setBothError('유효한 데이터가 없습니다. 형식: 상품코드 EA/BOX 무게(kg)');
        setBothProcessing(false);
        return;
      }

      const updatedList = [];

      for (const update of updates) {
        const { data: currentData } = await supabase
          .from('products')
          .select('product_code, product_name, ea_per_box, weight_per_box')
          .eq('product_code', update.productCode)
          .single();

        const oldEaPerBox = currentData?.ea_per_box;
        const oldWeightPerBox = currentData?.weight_per_box;
        const productName = currentData?.product_name || '';

        const { error } = await supabase
          .from('products')
          .update({
            ea_per_box: update.eaPerBox,
            weight_per_box: update.weightPerBox
          })
          .eq('product_code', update.productCode);

        if (error) {
          updatedList.push({
            productCode: update.productCode,
            productName,
            oldEaPerBox,
            newEaPerBox: update.eaPerBox,
            oldWeightPerBox,
            newWeightPerBox: update.weightPerBox,
            status: '실패',
            error: error.message
          });
        } else {
          await supabase.from('product_history').insert({
            product_code: update.productCode,
            ea_per_box: update.eaPerBox,
            weight_per_box: update.weightPerBox,
            changed_by: user?.email || 'unknown',
            source: 'EA/BOX 관리'
          });

          updatedList.push({
            productCode: update.productCode,
            productName,
            oldEaPerBox,
            newEaPerBox: update.eaPerBox,
            oldWeightPerBox,
            newWeightPerBox: update.weightPerBox,
            status: '성공'
          });
        }
      }

      setBothUpdatedItems(updatedList);
      setBothSuccess(true);

    } catch (err) {
      console.error('동시 업데이트 오류:', err);
      setBothError('업데이트 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setBothProcessing(false);
    }
  };

  // 단일 값 결과 테이블 컴포넌트
  const ResultTable = ({ items, valueLabel }) => (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-3">업데이트 결과</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 border">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">상품코드</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">상품명</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">기존 {valueLabel}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">새 {valueLabel}</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">상태</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item, index) => (
              <tr key={index} className={item.status === '성공' ? 'bg-green-50' : 'bg-red-50'}>
                <td className="px-4 py-3 text-sm font-medium">
                  <button
                    onClick={() => handleViewHistory(item.productCode)}
                    className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    title="변경 이력 보기"
                  >
                    {item.productCode}
                  </button>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{item.productName || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 text-right">{item.oldValue ?? '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{item.newValue}</td>
                <td className="px-4 py-3 text-sm text-center">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full
                    ${item.status === '성공' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {item.status}
                  </span>
                  {item.error && <div className="text-xs text-red-600 mt-1">{item.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // 동시 입력 결과 테이블 컴포넌트
  const BothResultTable = ({ items }) => (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-3">업데이트 결과</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">상품코드</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">상품명</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">기존 EA/BOX</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">새 EA/BOX</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">기존 무게</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">새 무게</th>
              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">상태</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item, index) => (
              <tr key={index} className={item.status === '성공' ? 'bg-green-50' : 'bg-red-50'}>
                <td className="px-3 py-2 font-medium">
                  <button
                    onClick={() => handleViewHistory(item.productCode)}
                    className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    title="변경 이력 보기"
                  >
                    {item.productCode}
                  </button>
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-[150px] truncate">{item.productName || '-'}</td>
                <td className="px-3 py-2 text-gray-500 text-right">{item.oldEaPerBox ?? '-'}</td>
                <td className="px-3 py-2 text-gray-900 text-right font-medium">{item.newEaPerBox}</td>
                <td className="px-3 py-2 text-gray-500 text-right">{item.oldWeightPerBox ?? '-'}</td>
                <td className="px-3 py-2 text-gray-900 text-right font-medium">{item.newWeightPerBox}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full
                    ${item.status === '성공' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {item.status}
                  </span>
                  {item.error && <div className="text-xs text-red-600 mt-1">{item.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <AuthLayout>
      <Head>
        <title>EA/BOX 관리</title>
        <meta name="description" content="상품별 EA/BOX 및 무게 관리" />
      </Head>

      <main className="py-6 px-4">
        <div className="max-w-5xl mx-auto bg-white p-6 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
            EA/BOX 관리
          </h1>

          {/* 탭 메뉴 */}
          <div className="flex border-b border-gray-300 mb-6">
            <button
              onClick={() => setActiveTab('both')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'both'
                  ? 'border-b-2 border-purple-600 text-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
              }`}
            >
              동시 입력
            </button>
            <button
              onClick={() => setActiveTab('eabox')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'eabox'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-blue-600'
              }`}
            >
              EA/BOX만
            </button>
            <button
              onClick={() => setActiveTab('weight')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'weight'
                  ? 'border-b-2 border-green-600 text-green-600'
                  : 'text-gray-600 hover:text-green-600'
              }`}
            >
              무게만
            </button>
          </div>

          {/* 동시 입력 탭 */}
          {activeTab === 'both' && (
            <div>
              <form onSubmit={updateBoth} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    상품코드, EA/BOX, 박스당중량(kg) 입력 (공백 또는 탭으로 구분)
                  </label>
                  <textarea
                    value={bothText}
                    onChange={(e) => setBothText(e.target.value)}
                    placeholder="예시:&#10;MLDL-BP02KK02 20 12.5&#10;ABC-12345 12 8.2&#10;XYZ-99999 24 15.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                    rows={8}
                    required
                  />
                </div>

                {bothError && (
                  <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
                    {bothError}
                  </div>
                )}

                {bothSuccess && (
                  <div className="p-3 bg-green-100 text-green-700 rounded-md text-sm">
                    EA/BOX와 무게가 성공적으로 업데이트되었습니다.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={bothProcessing || !bothText.trim()}
                  className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                    bothProcessing || !bothText.trim()
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {bothProcessing ? '처리 중...' : 'EA/BOX + 무게 동시 업데이트'}
                </button>
              </form>

              {bothUpdatedItems.length > 0 && (
                <BothResultTable items={bothUpdatedItems} />
              )}

              <div className="mt-6 p-4 bg-purple-50 rounded-md">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">사용 방법</h3>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                  <li>각 줄에 <strong>상품코드, EA/BOX, 무게(kg)</strong> 순서로 입력합니다</li>
                  <li>공백 또는 탭으로 구분합니다</li>
                  <li>엑셀에서 3열(상품코드, EA/BOX, 무게)을 복사하여 붙여넣기 가능합니다</li>
                  <li>소수점 무게 입력 가능합니다 (예: 12.5)</li>
                </ul>
              </div>
            </div>
          )}

          {/* EA/BOX 탭 */}
          {activeTab === 'eabox' && (
            <div>
              <form onSubmit={updateEaBox} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    상품코드, EA/BOX 입력 (공백 또는 탭으로 구분)
                  </label>
                  <textarea
                    value={eaBoxText}
                    onChange={(e) => setEaBoxText(e.target.value)}
                    placeholder="예시:&#10;MLDL-BP02KK02 20&#10;ABC-12345 12"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    rows={8}
                    required
                  />
                </div>

                {eaBoxError && (
                  <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
                    {eaBoxError}
                  </div>
                )}

                {eaBoxSuccess && (
                  <div className="p-3 bg-green-100 text-green-700 rounded-md text-sm">
                    EA/BOX가 성공적으로 업데이트되었습니다.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={eaBoxProcessing || !eaBoxText.trim()}
                  className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                    eaBoxProcessing || !eaBoxText.trim()
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {eaBoxProcessing ? '처리 중...' : 'EA/BOX 업데이트'}
                </button>
              </form>

              {eaBoxUpdatedItems.length > 0 && (
                <ResultTable items={eaBoxUpdatedItems} valueLabel="EA/BOX" />
              )}

              <div className="mt-6 p-4 bg-blue-50 rounded-md">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">사용 방법</h3>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                  <li>각 줄에 상품코드와 EA/BOX를 입력합니다 (공백 또는 탭으로 구분)</li>
                  <li>여러 상품을 한 번에 업데이트할 수 있습니다</li>
                  <li>엑셀에서 복사하여 붙여넣기 가능합니다</li>
                </ul>
              </div>
            </div>
          )}

          {/* 무게 탭 */}
          {activeTab === 'weight' && (
            <div>
              <form onSubmit={updateWeight} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    상품코드, 박스당중량(kg) 입력 (공백 또는 탭으로 구분)
                  </label>
                  <textarea
                    value={weightText}
                    onChange={(e) => setWeightText(e.target.value)}
                    placeholder="예시:&#10;MLDL-BP02KK02 12.5&#10;ABC-12345 8.2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
                    rows={8}
                    required
                  />
                </div>

                {weightError && (
                  <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
                    {weightError}
                  </div>
                )}

                {weightSuccess && (
                  <div className="p-3 bg-green-100 text-green-700 rounded-md text-sm">
                    박스당중량이 성공적으로 업데이트되었습니다.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={weightProcessing || !weightText.trim()}
                  className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                    weightProcessing || !weightText.trim()
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {weightProcessing ? '처리 중...' : '무게 업데이트'}
                </button>
              </form>

              {weightUpdatedItems.length > 0 && (
                <ResultTable items={weightUpdatedItems} valueLabel="무게(kg)" />
              )}

              <div className="mt-6 p-4 bg-green-50 rounded-md">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">사용 방법</h3>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                  <li>각 줄에 상품코드와 박스당중량(kg)을 입력합니다 (공백 또는 탭으로 구분)</li>
                  <li>소수점 입력 가능합니다 (예: 12.5)</li>
                  <li>여러 상품을 한 번에 업데이트할 수 있습니다</li>
                  <li>엑셀에서 복사하여 붙여넣기 가능합니다</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 이력 조회 모달 */}
      {historyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-800">
                변경 이력 - {historyProductCode}
              </h3>
              <button
                onClick={() => setHistoryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {historyLoading ? (
                <div className="text-center py-8 text-gray-500">
                  로딩 중...
                </div>
              ) : historyData.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  변경 이력이 없습니다.
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">변경일시</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">EA/BOX</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">박스당중량(kg)</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">변경자</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">출처</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {historyData.map((item, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 text-gray-600">
                          {item.changed_at ? new Date(item.changed_at).toLocaleString('ko-KR') : '-'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {item.ea_per_box ?? '-'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {item.weight_per_box ?? '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {item.changed_by || '-'}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {item.source || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setHistoryModal(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
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
