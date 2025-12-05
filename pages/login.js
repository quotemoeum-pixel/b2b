// pages/login.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from './_app';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();
  const { login, signUp, isLoggedIn } = useAuth();

  // 저장된 이메일 불러오기
  useEffect(() => {
    const savedEmail = localStorage.getItem('savedEmail');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  // 이미 로그인되어 있으면 메인 페이지로 리다이렉트
  if (isLoggedIn) {
    router.push('/');
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    if (isSignUp) {
      // 회원가입 후 자동 로그인
      const { success: signUpSuccess, error: signUpError } = await signUp(email, password);

      if (signUpSuccess) {
        // 바로 로그인 시도
        const { success: loginSuccess } = await login(email, password);

        if (loginSuccess) {
          if (rememberMe) {
            localStorage.setItem('savedEmail', email);
          }
          router.push('/');
          return;
        } else {
          setSuccess('회원가입이 완료되었습니다! 로그인해주세요.');
          setIsSignUp(false);
          setPassword('');
        }
      } else {
        setError(signUpError);
      }
    } else {
      // 로그인
      const { success, error } = await login(email, password);

      if (success) {
        // 로그인 저장 처리
        if (rememberMe) {
          localStorage.setItem('savedEmail', email);
        } else {
          localStorage.removeItem('savedEmail');
        }
        router.push('/');
      } else {
        setError(error);
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <Head>
        <title>{isSignUp ? '회원가입' : '로그인'}</title>
      </Head>

      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
          물류 관리 시스템
        </h1>
        <p className="text-center text-gray-500 mb-8">
          {isSignUp ? '회원가입' : '로그인'}
        </p>

        {error && (
          <div className="p-4 mb-6 bg-red-100 text-red-700 rounded-md text-center">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 mb-6 bg-green-100 text-green-700 rounded-md text-center">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">
              이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@company.com"
              className="w-full px-4 py-3 text-lg border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? '4자 이상 입력' : '비밀번호'}
              className="w-full px-4 py-3 text-lg border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={4}
            />
          </div>

          {!isSignUp && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="rememberMe" className="ml-2 text-sm text-gray-700">
                이메일 저장
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 px-4 text-xl rounded-md text-white font-medium ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : isSignUp
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setSuccess('');
            }}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            {isSignUp ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입'}
          </button>
        </div>
      </div>
    </div>
  );
}
