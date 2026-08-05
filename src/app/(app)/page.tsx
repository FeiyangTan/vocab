import { redirect } from 'next/navigation';

/**
 * 原来这里是个「三个入口」的启动页。现在三个功能常驻在菜单上、还带数量角标，
 * 这一层就成了多余的一次点击 —— 直接进复习，那是打开应用最常做的事。
 */
export default function Home() {
  redirect('/review');
}
