/**
 * 积木入门向导 —— 给第一次用的人（尤其是小朋友）指路。
 *
 * 设计要点：**向导能替用户操作界面**，不只是念文字。
 * 每一步都带一个「带我做」按钮，点一下就真的展开分类、真的加上积木、
 * 真的填上示例文字。用户看一遍就明白积木是怎么拼起来的。
 *
 * 步骤定义在这里，具体操作由 visual.js 注入（ops）——
 * 这样向导文件不用知道 visual.js 内部怎么实现的。
 */

/**
 * @param {object} ops 由 visual.js 注入的操作能力
 * @param {(catId:string)=>void} ops.openCategory  展开左栏某个分类
 * @param {(op:string)=>void}    ops.addBlock       加一条积木（按 id）
 * @param {(text:string)=>void}  ops.setMessageText 改掉「对玩家说」里的文字
 * @param {(op:string)=>void}    ops.putInBody      往「如果」的容器槽里放一条积木
 * @param {()=>void}             ops.preview       点「编译预览」
 * @param {()=>void}             ops.save          点「保存」
 */
export function makeGuideSteps(ops) {
  return [
    {
      title: '① 认识三个地方',
      body: '左边是<b>积木盒</b>，中间是<b>画布</b>，右边能看<b>生成出来的 Java</b>。'
        + '你只要从左边拿积木，丢到中间，程序就搭好了。',
      tip: '不用点「下一步」，先四处看看也行。',
    },
    {
      title: '② 程序总得有个开头',
      body: '开头叫「<b>事件</b>」—— 就是在问「什么时候做这件事」。'
        + '点左边的<b>事件</b>分类，把里面那几条看看。',
      do: '展开事件分类',
      action: () => ops.openCategory('event'),
    },
    {
      title: '③ 加一个事件',
      body: '「当玩家每 tick 时」的意思是：游戏每走一小步，就触发一次。'
        + '点它一下，画布上就会出现一个<b>帽子</b>—— 一段新程序的起点。',
      do: '帮我加「当玩家每 tick 时」',
      action: () => ops.addBlock('event.player_tick'),
    },
    {
      title: '④ 帽子下面是做事的地方',
      body: '事件只是「什么时候」，还得有「做什么」。'
        + '做事的积木在<b>玩家</b>分类里 —— 先把它打开看看。',
      do: '展开玩家分类',
      action: () => ops.openCategory('player'),
    },
    {
      title: '⑤ 让玩家说句话',
      body: '「对玩家说」这条积木，会在游戏里弹出一行字。点它一下，'
        + '它就接到帽子下面去了。',
      do: '帮我加「对玩家说」',
      action: () => ops.addBlock('player.message'),
    },
    {
      title: '⑥ 换成你想说的话',
      body: '积木上的<b>白色小框</b>就是可以改的地方。'
        + '点进去，把字删掉，换成你自己的话。',
      do: '帮我填一句示例',
      action: () => ops.setMessageText('你好呀！我做了一个模组！'),
    },
    {
      title: '⑦ 「如果」能装一整块',
      body: '有些事只在特定时候做，就用「<b>如果…那么</b>」。'
        + '它下面有个<b>凹槽</b>，能再塞进别的积木。',
      do: '帮我加一条「如果」',
      action: () => {
        ops.openCategory('flow');
        ops.addBlock('flow.if');
      },
    },
    {
      title: '⑧ 把「治疗」放进凹槽',
      body: '在「如果」下面那个凹槽里放一条积木，'
        + '只有条件成立时才会做这件事。这里放一条「给玩家加血」。',
      do: '帮我放进凹槽',
      action: () => ops.putInBody('player.heal'),
    },
    {
      title: '⑨ 看看变成了什么代码',
      body: '右上角点「<b>编译预览</b>」，右边立刻出现真正的 Java。'
        + '这不是给小朋友的玩具代码 —— 它跟手写的一模一样，能编译进 jar。',
      do: '帮我预览',
      action: () => ops.preview(),
    },
    {
      title: '⑩ 存下来',
      body: '点「<b>保存</b>」，程序就存进这个工程了。'
        + '以后「生成」和「构建 jar」都会把它一起编译进去。',
      do: '帮我保存',
      action: () => ops.save(),
    },
    {
      title: '⑪ 你已经会搭积木了',
      body: '接下来可以试这些：',
      tip: '左边积木盒里有一百多条积木，包括三个 Goety 模组的。'
        + '点顶栏「代码造积木」还能把一段 Java 变成自己的积木。',
      last: true,
    },
  ];
}
