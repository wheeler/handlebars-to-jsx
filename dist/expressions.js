"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Babel = require("@babel/types");
var elements_1 = require("./elements");
var blockStatements_1 = require("./blockStatements");
var comments_1 = require("./comments");
/**
 * Converts the Handlebars expression to NON-JSX JS-compatible expression.
 * Creates top-level expression or expression which need to wrap to JSX
 * expression container.
 */
exports.resolveStatement = function (statement) {
    switch (statement.type) {
        case 'ElementNode': {
            return elements_1.convertElement(statement);
        }
        case 'TextNode': {
            return Babel.stringLiteral(statement.chars);
        }
        case 'MustacheStatement': {
            // Handle Custom Mustaches
            var resolvedCustom = handleCustomMustaches(statement);
            if (resolvedCustom)
                return resolvedCustom;
            var resolvedPath = exports.resolveExpression(statement.path);
            // If there are params output a call expression with resolved params
            if (statement.params.length) {
                var resolvedParams = statement.params.map(function (p) { return exports.resolveExpression(p); });
                return Babel.callExpression(resolvedPath, resolvedParams);
            }
            return resolvedPath;
        }
        case 'BlockStatement': {
            // Handle Custom Mustaches
            var resolvedCustom = handleCustomMustaches(statement);
            if (resolvedCustom)
                return resolvedCustom;
            return blockStatements_1.resolveBlockStatement(statement);
        }
        case 'MustacheCommentStatement':
        case 'CommentStatement': {
            throw new Error('Top level comments currently is not supported');
        }
        default: {
            throw new Error("Unexpected expression \"" + statement.type + "\"");
        }
    }
};
var getParamValue = function (thing, idx) { return (thing.params[idx] && thing.params[idx].value); };
// TODO this is crappy - can it be replaced with something built in?
var resolveJsxAttribute = function (expression) {
    var resolvedExpression = exports.resolveExpression(expression);
    switch (resolvedExpression.type) {
        case "MemberExpression": {
            return Babel.jsxExpressionContainer(resolvedExpression);
        }
        default: {
            return resolvedExpression;
        }
    }
};
// TODO this is crappy - can it be replaced with something built in?
var resolveJsxElement = function (expression) {
    var resolvedExpression = exports.resolveExpression(expression);
    switch (resolvedExpression.type) {
        case "MemberExpression": {
            return Babel.jsxExpressionContainer(resolvedExpression);
        }
        case "StringLiteral": {
            return Babel.jsxText(resolvedExpression.value);
        }
        default: {
            return resolvedExpression;
        }
    }
};
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
var hbsToJsxMap = {
    buttonWithIcon: {
        identifier: 'Button',
        paramMappings: [
            { type: 'children' },
            { type: 'attribute', identifier: 'icon', preprocessor: function (p) { p.value = p.value.replace(/zp-icon-? ?/g, ''); } },
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
    }
};
var handleCustomMustaches = function (statement) {
    var hbsIdentifier = statement.path && statement.path.original;
    var hbsTranslation = hbsToJsxMap[hbsIdentifier];
    if (!hbsTranslation)
        return undefined;
    var params = statement.params;
    var children;
    var attributes = [];
    hbsTranslation.paramMappings.forEach(function (param, i) {
        switch (param.type) {
            case 'children': {
                if (params[i]) {
                    children = resolveJsxElement(params[i]);
                }
                break;
            }
            case 'attribute': {
                if (params[i]) {
                    if (param.preprocessor)
                        param.preprocessor(params[i]);
                    var resolvedValue = resolveJsxAttribute(params[i]);
                    attributes.push(Babel.jsxAttribute(Babel.jsxIdentifier(param.identifier), resolvedValue));
                }
                break;
            }
        }
    });
    // if there's a block body it becomes the children
    if (statement.type === 'BlockStatement' && statement.program) {
        children = exports.createRootChildren(statement.program.body);
        if (children.type === 'StringLiteral') {
            children = Babel.jsxText(children.value);
        }
        else if (children.type === 'MemberExpression' || children.type === 'CallExpression') {
            children = Babel.jsxExpressionContainer(children);
        }
    }
    var identifier = Babel.jsxIdentifier(hbsTranslation.identifier);
    return Babel.jsxElement(Babel.jsxOpeningElement(identifier, attributes, false), Babel.jsxClosingElement(identifier), [children], false);
};
/**
 * Converts the Handlebars node to JSX-children-compatible child element.
 * Creates JSX expression or expression container with JS expression, to place
 * to children of a JSX element.
 */
exports.resolveElementChild = function (statement) {
    switch (statement.type) {
        case 'ElementNode': {
            return elements_1.convertElement(statement);
        }
        case 'TextNode': {
            return Babel.jsxText(statement.chars);
        }
        case 'MustacheCommentStatement':
        case 'CommentStatement': {
            return comments_1.createComment(statement);
        }
        // If it expression, create a expression container
        default: {
            var resolved = exports.resolveStatement(statement);
            switch (resolved.type) {
                // Return if it is resolved to JSX
                case 'JSXText':
                case 'JSXElement':
                case 'JSXExpressionContainer': {
                    return resolved;
                }
                default: {
                    return Babel.jsxExpressionContainer(resolved);
                }
            }
        }
    }
};
/**
 * Converts Hbs expression to Babel expression
 */
exports.resolveExpression = function (expression) {
    switch (expression.type) {
        case 'PathExpression': {
            return exports.createPath(expression);
        }
        case 'BooleanLiteral': {
            return Babel.booleanLiteral(expression.value);
        }
        case 'NullLiteral': {
            return Babel.nullLiteral();
        }
        case 'NumberLiteral': {
            return Babel.numericLiteral(expression.value);
        }
        case 'StringLiteral': {
            return Babel.stringLiteral(expression.value);
        }
        case 'UndefinedLiteral': {
            return Babel.identifier('undefined');
        }
        default: {
            throw new Error('Unexpected mustache statement');
        }
    }
};
/**
 * Returns path to variable
 */
exports.createPath = function (pathExpression) {
    var parts = pathExpression.parts;
    if (parts.length === 0) {
        throw new Error('Unexpected empty expression parts');
    }
    // Start identifier
    var acc = Babel.identifier(parts[0]);
    for (var i = 1; i < parts.length; i++) {
        acc = exports.appendToPath(acc, Babel.identifier(parts[i]));
    }
    return acc;
};
/**
 * Appends item to path
 */
exports.appendToPath = function (path, append) {
    return Babel.memberExpression(path, append);
};
/**
 * Prepends item to path
 */
exports.prependToPath = function (path, prepend) {
    return Babel.memberExpression(prepend, path);
};
/**
 * Converts child statements of element to JSX-compatible expressions
 * @param body List of Glimmer statements
 */
exports.createChildren = function (body) {
    return body.map(function (statement) { return exports.resolveElementChild(statement); });
};
/**
 * Converts root children
 */
exports.createRootChildren = function (body) {
    return body.length === 1 ? exports.resolveStatement(body[0]) : elements_1.createFragment(exports.createChildren(body));
};
/**
 * Creates attribute value concatenation
 */
exports.createConcat = function (parts) {
    return parts.reduce(function (acc, item) {
        if (acc == null) {
            return exports.resolveStatement(item);
        }
        return Babel.binaryExpression('+', acc, exports.resolveStatement(item));
    }, null);
};
