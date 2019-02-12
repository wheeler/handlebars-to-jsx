import { AST as Glimmer }                 from '@glimmer/syntax'
import * as Babel                         from '@babel/types'
import { createFragment, convertElement } from './elements'
import { resolveBlockStatement }          from './blockStatements'
import { createComment }                  from './comments'

/**
 * Converts the Handlebars expression to NON-JSX JS-compatible expression.
 * Creates top-level expression or expression which need to wrap to JSX
 * expression container.
 */
export const resolveStatement = (statement: Glimmer.Statement): Babel.Expression => {
  switch (statement.type) {
    case 'ElementNode': {
      return convertElement(statement)
    }

    case 'TextNode': {
      return Babel.stringLiteral(statement.chars)
    }

    case 'MustacheStatement': {
      // Handle Custom Mustaches
      const resolvedCustom = handleCustomMustaches(statement);
      if (resolvedCustom) return resolvedCustom;

      const resolvedPath = resolveExpression(statement.path)
      
      // If there are params output a call expression with resolved params
      if (statement.params.length) {
        const resolvedParams = statement.params.map((p) => resolveExpression(p))
        return Babel.callExpression(resolvedPath, resolvedParams)
      }

      return resolvedPath
    }

    case 'BlockStatement': {      
      // Handle Custom Mustaches
      const resolvedCustom = handleCustomMustaches(statement);
      if (resolvedCustom) return resolvedCustom;

      return resolveBlockStatement(statement)
    }

    case 'MustacheCommentStatement':
    case 'CommentStatement': {
      throw new Error('Top level comments currently is not supported')
    }

    default: {
      throw new Error(`Unexpected expression "${statement.type}"`)
    }
  }
}

const getParamValue = (thing, idx) => (thing.params[idx] && thing.params[idx].value)

const resolveJsxAttribute = (expression) => {
  const resolvedExpression = resolveExpression(expression)
  switch (resolvedExpression.type) {
    case "MemberExpression": {
      return Babel.jsxExpressionContainer(resolvedExpression)
    }
    default: {
      return resolvedExpression
    }
  }
}

const resolveJsxElement = (expression) => {
  const resolvedExpression = resolveExpression(expression)
  switch (resolvedExpression.type) {
    case "MemberExpression": {
      return Babel.jsxExpressionContainer(resolvedExpression)
    }
    case "StringLiteral": {
      return Babel.jsxText(resolvedExpression.value)
    }
    default: {
      return resolvedExpression
    }
  }
}

/**
 * Example:
 * 
 * HBS in
 * {{#linkTo '/destination' '' 'btn' '' }}
 *   <i class='zp-icon zp-icon-arrow-back'></i> Back to Giving
 * {{/linkTo}}
 *
 * React out
 * <Link href='/destination' className='btn'>
 *   <i class='zp-icon zp-icon-arrow-back'></i> Back to Giving
 * </Link>
 */

const hbsToJsxMap = {
  buttonWithIcon: {
    identifier: 'Button',
    paramMappings: [
      { type: 'children' },
      { type: 'attribute', identifier: 'icon', preprocessor: p => { p.value = p.value.replace(/zp-icon-? ?/g, '') } },
      { type: 'attribute', identifier: 'className' },
    ]
  },
  linkTo: {
    identifier: 'Link',
    paramMappings: [
      { type: 'attribute', identifier: 'href' },
      { type: 'children' },
      { type: 'attribute', identifier: 'className' },
    ]
  },
  externalLinkTo: {
    identifier: 'LinkExternal',
    paramMappings: [
      { type: 'attribute', identifier: 'href' },
      { type: 'children' },
      { type: 'attribute', identifier: 'className' },
    ]
  },
}

const handleCustomMustaches = (statement: Glimmer.MustacheStatement | Glimmer.BlockStatement): Babel.JSXElement | undefined => {
  const hbsIdentifier = statement.path && statement.path.original;
  const hbsTranslation = hbsToJsxMap[hbsIdentifier];
  if (!hbsTranslation) return undefined;

  const { params } = statement;
  let children;
  const attributes: Babel.JSXAttribute[] = [];

  hbsTranslation.paramMappings.forEach((param, i) => {
    switch (param.type) {
      case 'children': {
        if (params[i]) {
          children = resolveJsxElement(params[i])
        }
        break;
      }
      case 'attribute': {
        if (params[i]) {
          if (param.preprocessor) param.preprocessor(params[i])
          const resolvedValue = resolveJsxAttribute(params[i])
          attributes.push(Babel.jsxAttribute(Babel.jsxIdentifier(param.identifier), resolvedValue))
        }
        break;
      }
    }
  })

  // if there's a block body it becomes the children
  if (statement.type === 'BlockStatement' && statement.program) {
    children = createRootChildren(statement.program.body);
    if (children.type === 'StringLiteral') {
      children = Babel.jsxText((<Babel.StringLiteral>children).value)
    } else if (children.type === 'MemberExpression') {
      children = Babel.jsxExpressionContainer(children)
    }
  }

  const identifier = Babel.jsxIdentifier(hbsTranslation.identifier);
  return Babel.jsxElement(
    Babel.jsxOpeningElement(identifier, attributes, false),
    Babel.jsxClosingElement(identifier),
    [children],
    false
  )
}


/**
 * Converts the Handlebars node to JSX-children-compatible child element.
 * Creates JSX expression or expression container with JS expression, to place
 * to children of a JSX element.
 */
export const resolveElementChild = (
  statement: Glimmer.Statement
): Babel.JSXText | Babel.JSXElement | Babel.JSXExpressionContainer => {
  switch (statement.type) {
    case 'ElementNode': {
      return convertElement(statement)
    }

    case 'TextNode': {
      return Babel.jsxText(statement.chars)
    }

    case 'MustacheCommentStatement':
    case 'CommentStatement': {
      return createComment(statement)
    }

    // If it expression, create a expression container
    default: {
      const resolved = resolveStatement(statement)
      switch (resolved.type) {
        // Return if it is resolved to JSX
        case 'JSXText':
        case 'JSXElement':
        case 'JSXExpressionContainer': {
          return resolved;
        }
        default: {
          return Babel.jsxExpressionContainer(resolved)
        }
      }
    }
  }
}
/**
 * Converts Hbs expression to Babel expression
 */
export const resolveExpression = (
  expression: Glimmer.Expression
): Babel.Literal | Babel.Identifier | Babel.MemberExpression => {
  switch (expression.type) {
    case 'PathExpression': {
      return createPath(expression)
    }

    case 'BooleanLiteral': {
      return Babel.booleanLiteral(expression.value)
    }

    case 'NullLiteral': {
      return Babel.nullLiteral()
    }

    case 'NumberLiteral': {
      return Babel.numericLiteral(expression.value)
    }

    case 'StringLiteral': {
      return Babel.stringLiteral(expression.value)
    }

    case 'UndefinedLiteral': {
      return Babel.identifier('undefined')
    }

    default: {
      throw new Error('Unexpected mustache statement')
    }
  }
}

/**
 * Returns path to variable
 */
export const createPath = (pathExpression: Glimmer.PathExpression): Babel.Identifier | Babel.MemberExpression => {
  const parts = pathExpression.parts

  if (parts.length === 0) {
    throw new Error('Unexpected empty expression parts')
  }

  // Start identifier
  let acc: Babel.Identifier | Babel.MemberExpression = Babel.identifier(parts[0])

  for (let i = 1; i < parts.length; i++) {
    acc = appendToPath(acc, Babel.identifier(parts[i]))
  }

  return acc
}

/**
 * Appends item to path
 */
export const appendToPath = (path: Babel.MemberExpression | Babel.Identifier, append: Babel.Identifier) =>
  Babel.memberExpression(path, append)

/**
 * Prepends item to path
 */
export const prependToPath = (path: Babel.MemberExpression | Babel.Identifier, prepend: Babel.Identifier) =>
  Babel.memberExpression(prepend, path)

/**
 * Converts child statements of element to JSX-compatible expressions
 * @param body List of Glimmer statements
 */
export const createChildren = (body: Glimmer.Statement[]): Babel.JSXElement['children'] =>
  body.map(statement => resolveElementChild(statement))

/**
 * Converts root children
 */
export const createRootChildren = (body: Glimmer.Statement[]): Babel.Expression =>
  body.length === 1 ? resolveStatement(body[0]) : createFragment(createChildren(body))

/**
 * Creates attribute value concatenation
 */
export const createConcat = (parts: Glimmer.ConcatStatement['parts']): Babel.BinaryExpression | Babel.Expression => {
  return parts.reduce(
    (acc, item) => {
      if (acc == null) {
        return resolveStatement(item)
      }

      return Babel.binaryExpression('+', acc, resolveStatement(item))
    },
    null as null | Babel.Expression | Babel.BinaryExpression
  ) as Babel.BinaryExpression | Babel.Expression
}
