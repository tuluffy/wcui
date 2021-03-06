/**
 * markdown解析器
 * @author yutent<yutent.io@gmail.com>
 * @date 2020/02/07 17:14:19
 */

const HR_LIST = ['=', '-', '_', '*']
const LIST_REG = /^(([\+\-\*])|(\d+\.))\s/
const TODO_REG = /^\-\s\[(x|\s)\]\s/
const ESCAPE_REG = /\\([-+*_`])/g
const QLINK_REG = /^\[(\d+)\]: ([\S]+)\s*?((['"])[\s\S]*?\4)?\s*?$/
const TAG_REG = /<([\w\-]+)([\w\W]*?)>/g
const ATTR_REG = /^[\s\S]*?(style="[^"]*?")[\s\S]*?$/

const INLINE = {
  code: /`([^`]*?[^`\\\s])`/g,
  strong: [/__([\s\S]*?[^\s\\])__(?!_)/g, /\*\*([\s\S]*?[^\s\\])\*\*(?!\*)/g],
  em: [/_([\s\S]*?[^\s\\])_(?!_)/g, /\*([\s\S]*?[^\s\\*])\*(?!\*)/g],
  del: /~~([\s\S]*?[^\s\\~])~~/g,
  qlink: /\[([^\]]*?)\]\[(\d*?)\]/g, // 引用链接
  img: /\!\[([^\]]*?)\]\(([^)]*?)\)/g,
  a: /\[([^\]]*?)\]\(([^)]*?)(\s+"([\s\S]*?)")*?\)/g,
  qlist: /((<blockquote class="md\-quote">)*?)([\+\-\*]|\d+\.) (.*)/ // 引用中的列表
}

const Helper = {
  // 是否分割线
  isHr(str) {
    var s = str[0]
    if (HR_LIST.includes(s)) {
      var reg = new RegExp('^\\' + escape(s) + '{3,}$')
      return reg.test(str)
    }
    return false
  },
  // 是否列表, -1不是, 1为有序列表, 0为无序列表
  isList(str) {
    var v = str.trim()
    if (LIST_REG.test(v)) {
      var n = +v[0]
      if (n === n) {
        return 1
      } else {
        return 0
      }
    }
    return -1
  },
  // 是否任务列表
  isTodo(str) {
    var v = str.trim()
    if (TODO_REG.test(v)) {
      return v[3] === 'x' ? 1 : 0
    }
    return -1
  },
  ltrim(str) {
    if (str.trimStart) {
      return str.trimStart()
    }
    return str.replace(/^\s+/, '')
  },
  isQLink(str) {
    if (QLINK_REG.test(str)) {
      return { [RegExp.$1]: { l: RegExp.$2, t: RegExp.$3 } }
    }
    return false
  },
  isTable(str) {
    return /^\|.+?\|$/.test(str)
  }
}

const Decoder = {
  // 内联样式
  inline(str) {
    return str
      .replace(INLINE.code, '<code class="inline">$1</code>')
      .replace(INLINE.strong[0], '<strong>$1</strong>')
      .replace(INLINE.strong[1], '<strong>$1</strong>')
      .replace(INLINE.em[0], '<em>$1</em>')
      .replace(INLINE.em[1], '<em>$1</em>')
      .replace(INLINE.del, '<del>$1</del>')
      .replace(INLINE.img, '<img src="$2" alt="$1">')
      .replace(INLINE.a, (m1, txt, link, m2, attr = '') => {
        var tmp = attr
          .split(';')
          .filter(_ => _)
          .map(_ => {
            var a = _.split('=')
            if (a.length > 1) {
              return `${a[0]}="${a[1]}"`
            } else {
              return `title="${_}"`
            }
          })
          .join(' ')

        return `<a href="${link.trim()}" ${tmp}>${txt}</a>`
      })
      .replace(INLINE.qlink, (m, txt, n) => {
        var _ = this.__LINKS__[n]
        if (_) {
          var a = _.t ? `title=${_.t}` : ''
          return `<a href="${_.l}" ${a}>${txt}</a>`
        } else {
          return m
        }
      })
      .replace(ESCAPE_REG, '$1') // 处理转义字符
  },
  // 分割线
  hr() {
    return '<fieldset class="md-hr"><legend></legend></fieldset>'
  },
  // 标题
  head(str) {
    if (str.startsWith('#')) {
      return str.replace(/^(#{1,6}) (.*)/, (p, m1, m2) => {
        m2 = m2.trim()
        let level = m1.trim().length
        let hash = m2.replace(/\s/g, '').replace(/<\/?[^>]*?>/g, '')

        if (level === 1) {
          return `<h1>${m2}</h1>`
        } else {
          return `<h${level}><a href="#${hash}" class="md-head-link">${m2}</a></h${level}>`
        }
      })
    }
    return false
  },
  // 引用模块
  blockquote(str) {
    //
  },
  // 任务
  task(str) {
    var todoChecked = Helper.isTodo(str)
    if (~todoChecked) {
      var word = str.replace(TODO_REG, '').trim()
      var stat = todoChecked === 1 ? 'checked' : ''
      var txt = todoChecked === 1 ? `<del>${word}</del>` : word

      return `<section><wc-checkbox-item readonly ${stat}>${txt}</wc-checkbox-item></section>`
    }
    return false
  }
}

class Tool {
  constructor(list, links) {
    this.list = list
    this.__LINKS__ = links
  }

  // 初始化字符串, 处理多余换行等
  static init(str) {
    // 去掉\r, 将\t转为空格(2个)
    str = str
      .replace(/\r\n|\r/g, '\n')
      .replace(/\t/g, '  ')
      .replace(/\u00a0/g, ' ')
      .replace(/\u2424/g, '\n')
      .replace(TAG_REG, (m, name, attr) => {
        attr = attr.replace(/\n/g, '⨨☇') // 标签内的换行, 转为一组特殊字符, 方便后面还原
        if (attr) {
          attr = ' ' + attr
        }
        return `<${name + attr}>`
      })

    var links = {}
    var list = []
    var lines = str.split('\n')
    var isCodeBlock = false // 是否代码块
    var isTable = false // 是否表格
    var emptyLineLength = 0 //连续空行的数量

    for (let it of lines) {
      let tmp = it.trim()

      // 非空行
      if (tmp) {
        emptyLineLength = 0
        if (tmp.startsWith('```')) {
          if (isCodeBlock) {
            list.push('</wc-code>')
          } else {
            list.push(tmp.replace(/^```([\w\#\-]*?)$/, '<wc-code lang="$1">'))
          }
          isCodeBlock = !isCodeBlock
        } else if (Helper.isTable(tmp) && !isTable) {
          var thead = tmp.split('|')
          // 去头去尾
          thead.shift()
          thead.pop()
          list.push(
            `<table><thead><tr>${thead
              .map(_ => `<th>${_}</th>`)
              .join('')}</tr></thead><tbody>`
          )
          isTable = true
        } else {
          var qlink
          if (isCodeBlock) {
            it = it
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/⨨☇/g, '\n') // 代码块要还原回换行
          } else {
            it = it
              .replace(/(⨨☇)+/g, ' ') // 非代码块直接转为空格, 并进行xss过滤
              .replace(INLINE.code, (m, txt) => {
                return `\`${txt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}\``
              })
              .replace(/<(\/?)script[^>]*?>/g, '&lt;$1script&gt;')
              .replace(TAG_REG, (m, name, attr) => {
                attr = attr.replace(ATTR_REG, '$1').trim()
                return `<${name} ${attr}>`
              })
          }
          qlink = Helper.isQLink(it)

          if (qlink) {
            Object.assign(links, qlink)
          } else {
            list.push(it)
          }
        }
      } else {
        if (isTable) {
          isTable = false
          list.push('</tbody></table>')
          continue
        }
        if (list.length === 0 || (!isCodeBlock && emptyLineLength > 0)) {
          continue
        }
        emptyLineLength++
        list.push(tmp)
      }
    }
    return new this(list, links)
  }

  parse() {
    var html = ''
    var isCodeBlock = false // 是否代码块
    var emptyLineLength = 0 //连续空行的数量
    var isBlockquote = false
    var isTable = false
    var tableAlign = null
    var blockquoteLevel = 0
    var isParagraph = false

    var isList = false
    var orderListLevel = -1
    var unorderListLevel = -1

    var isQuoteList = false // 引用中的列表, 只支持一层级
    var quoteListStyle = 0 // 1有序,  2 无序

    //
    for (let it of this.list) {
      // 非空行
      if (it) {
        if (~it.indexOf('<table>') || ~it.indexOf('</table>')) {
          html += it
          isTable = !isTable
          tableAlign = true
          continue
        }

        if (isTable) {
          var tmp = it.split('|').map(_ => _.trim())
          tmp.shift()
          tmp.pop()

          // 表格分割行, 配置对齐方式的
          if (tableAlign === true) {
            tableAlign = tmp.map(a => {
              a = a.split(/\-+/)
              if (a[0] === ':' && a[1] === ':') {
                return 'align="center"'
              }
              if (a[1] === ':') {
                return 'align="right"'
              }
              return ''
            })
            continue
          }
          html += `<tr>${tmp
            .map((_, i) => `<td ${tableAlign[i]}>${_}</td>`)
            .join('')}</tr>`
          continue
        }

        // wc-code标签直接拼接
        if (~it.indexOf('wc-code')) {
          html += it
          isCodeBlock = !isCodeBlock
          continue
        }

        // 同上代码块的处理
        if (isCodeBlock) {
          html += '\n' + it
          continue
        }

        // 无属性标签
        if (Helper.isHr(it)) {
          html += Decoder.hr()
          continue
        }

        // 优先处理一些常规样式
        it = Decoder.inline.call(this, it)

        // 标题只能是单行
        var head = Decoder.head(it)
        if (head) {
          isParagraph = false
          html += head
          continue
        }

        // 引用
        if (it.startsWith('>')) {
          let innerQuote // 是否有缩进引用
          it = it.replace(/^(>+) /, (p, m) => {
            let len = m.length
            let tmp = ''
            let loop = len
            // 若之前已经有一个未闭合的引用, 需要减去已有缩进级别, 避免产生新的引用标签
            if (isBlockquote) {
              loop = len - blockquoteLevel
            } else {
            }

            while (loop > 0) {
              loop--
              tmp += '<blockquote class="md-quote">'
            }

            blockquoteLevel = len
            innerQuote = !!tmp
            return tmp
          })

          if (isBlockquote) {
            // 没有新的缩进引用时, 才添加换行
            if (innerQuote) {
              // 之前有引用的列表时, 直接结束列表
              if (isQuoteList) {
                html += `</${quoteListStyle === 1 ? 'ul' : 'ul'}>`
                isQuoteList = false
              }
            }
          }

          let qListChecked = it.match(INLINE.qlist)
          if (qListChecked) {
            let tmp1 = qListChecked[1] // 缩进的标签
            let tmp2 = +qListChecked[3] // 有序还是无序
            let tmp3 = qListChecked.pop() // 文本
            let currListStyle = tmp2 === tmp2 ? 1 : 2
            var qlist = ''

            // 已有列表
            if (isQuoteList) {
              // 因为只支持一层级的列表, 所以同一级别不区分有序无序, 强制统一
            } else {
              isQuoteList = true
              if (currListStyle === 1) {
                qlist += '<ol>'
              } else {
                qlist += '<ul>'
              }
            }

            quoteListStyle = currListStyle

            qlist += `<li>${tmp3}</li>`
            html += tmp1 + qlist
          } else {
            html += '<br>' + it
          }

          isParagraph = false
          isBlockquote = true
          continue
        }

        // 任务
        let task = Decoder.task(it)
        if (task) {
          html += task
          continue
        }

        // 列表
        let listChecked = Helper.isList(it)
        if (~listChecked) {
          // 左侧空格长度
          let tmp = Helper.ltrim(it)
          let ltrim = it.length - tmp.length
          let word = tmp.replace(LIST_REG, '').trim()
          let level = Math.floor(ltrim / 2)
          let tag = listChecked > 0 ? 'ol' : 'ul'

          if (isList) {
            if (listChecked === 1) {
              if (level > orderListLevel) {
                html = html.replace(/<\/li>$/, '')
                html += `<${tag}><li>${word}</li>`
              } else if (level === orderListLevel) {
                html += `<li>${word}</li>`
              } else {
                html += `</${tag}></li><li>${word}</li>`
              }
              orderListLevel = level
            } else {
              if (level > unorderListLevel) {
                html = html.replace(/<\/li>$/, '')
                html += `<${tag}><li>${word}</li>`
              } else if (level === unorderListLevel) {
                html += `<li>${word}</li>`
              } else {
                html += `</${tag}></li><li>${word}</li>`
              }
              unorderListLevel = level
            }
          } else {
            html += `<${tag}>`
            if (listChecked === 1) {
              orderListLevel = level
            } else {
              unorderListLevel = level
            }
            html += `<li>${word}</li>`
          }

          isList = true
          continue
        }

        // 无"> "前缀的引用, 继续拼到之前的, 并且不换行
        if (isBlockquote) {
          html += it
          continue
        }

        if (isParagraph) {
          html += `${it}<br>`
        } else {
          html += `<p>${it}<br>`
        }
        isParagraph = true
      } else {
        // 如果是在代码中, 直接拼接, 并加上换行
        if (isCodeBlock) {
          html += it + '\n'
        } else {
          emptyLineLength++

          // 引用结束
          if (isBlockquote) {
            isBlockquote = false
            if (emptyLineLength > 0) {
              emptyLineLength = 0
              while (blockquoteLevel > 0) {
                blockquoteLevel--
                html += '</blockquote>'
              }
            }
            continue
          }

          if (isList) {
            while (orderListLevel > -1 || unorderListLevel > -1) {
              if (orderListLevel > unorderListLevel) {
                html += '</ol>'
                orderListLevel--
              } else {
                html += '</ul>'
                unorderListLevel--
              }
            }
            isList = false
            continue
          }

          //
          if (isParagraph) {
            isParagraph = false
            html += '</p>'
          }
        }
      }
    }
    delete this.list
    delete this.__LINKS__
    return html
  }
}

export default function(str) {
  return Tool.init(str).parse()
}
