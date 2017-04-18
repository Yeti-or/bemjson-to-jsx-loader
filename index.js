'use strict';

const bemImport = require('@bem/import-notation');
const bemjsonToDecl = require('bemjson-to-decl');
const bemjsonToJSX = require('bemjson-to-jsx');
const nEval = require('node-eval');
const Cell = require('@bem/cell');
const bemWalk = require('@bem/walk');
const through = require('through2');
const loaderUtils = require('loader-utils');

const reactTMPL = (imports, JSX) =>
`
import React from 'react';
import ReactDOM from 'react-dom';
${imports}

ReactDOM.render(
  ${JSX},
  document.getElementById('root')
);
`;

module.exports = function(source) {
    this.cacheable && this.cacheable();
    const callback = this.async();
    const options = Object.assign({},
        this.options.bemLoader,
        loaderUtils.getOptions(this)
    );
    const levels = options.levels;
    const techs = options.techs || ['js'];

    new Promise((resolve, rej) => {
        const bemjson = nEval(source);

        // whiteList of entities on project level
        const whiteList = [];
        const walk = bemWalk(levels).pipe(through.obj((entity, _, next) => {
            next(null, ~techs.indexOf(entity.tech) ? entity : null);
        }));
        walk.on('data', file => whiteList.push(file.cell));
        walk.on('error', err => rej(err));
        walk.on('end', () => {

            const entities = bemjsonToDecl.convert(bemjson)
                .map(Cell.create)
                .filter(cell => whiteList.some(white => cell.entity.isEqual(white.entity)))
                .reduce((acc, cell) => {
                    // group by block and elems
                    const classId = cell.elem ? cell.block + '__' + cell.elem : cell.block;
                    (acc[classId] || (acc[classId] = [])).push(cell);
                    return acc;
                }, {});
            const imports = Object.keys(entities).map(k => {
                const className = bemjsonToJSX.tagToClass(k);
                return `import ${className} from '${bemImport.stringify(entities[k])}';`
            }).join('\n');

            const JSX = bemjsonToJSX().process(bemjson).JSX;

            const res = reactTMPL(imports, JSX);
            resolve(res);
        });
    })
    .then(res => callback(null, res))
    .catch(callback);
};
