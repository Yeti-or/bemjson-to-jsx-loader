'use strict';

const bemImport = require('@bem/import-notation');
const bemjsonToDecl = require('bemjson-to-decl');
const bemjsonToJSX = require('bemjson-to-jsx');
const nEval = require('node-eval');
const Cell = require('@bem/cell');
const BemEntity = require('@bem/entity-name');
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

const fs = require('fs');
const is_debug = process.env.DEBUG || false;

module.exports = function(source) {
    this.cacheable && this.cacheable();
    const callback = this.async();

    const options = Object.assign({},
        this.options.bemLoader,
        loaderUtils.getOptions(this)
    );
    const levels = options.levels;
    const techs = options.techs || ['js'];
    const plugins = options.bemjsonToJSXPlugins || [];
    const bemPath = options.bemPath;
    const techMap = techs.reduce((acc, tech) => {
        acc[tech] || (acc[tech] = [tech]);
        return acc;
    }, options.techMap || {});
    const extToTech = Object.keys(techMap).reduce((acc, tech) => {
        techMap[tech].forEach(ext => {
            acc[ext] = tech;
        });
        return acc;
    }, {});


    new Promise((resolve, rej) => {
        const bemjson = nEval(source);
        is_debug && fs.writeFileSync('/tmp/debug-bemjson.json', JSON.stringify(bemjson, null, 4));

        // whiteLists of entities on project level
        const whiteList = [];
        const cssList = [];
        const jsList = [];

        const walk = bemWalk(levels).pipe(through.obj((entity, _, next) => {
            next(null, extToTech[entity.tech] ? entity : null);
        }));
        walk.on('data', file => {
            whiteList.push(file.cell.entity);
            ~techMap['css'].indexOf(file.tech) && cssList.push(file.cell.entity)
            ~techMap['js'].indexOf(file.tech) && jsList.push(file.cell.entity)
        });
        walk.on('error', err => rej(err));
        walk.on('end', () => {

            const entities = bemjsonToDecl.convert(bemjson)
                .map(Cell.create)
                .filter(cell => whiteList.some(white => cell.entity.isEqual(white)))
                .reduce((acc, cell) => {
                    // group by block and elems
                    const classId = cell.elem ? cell.block + '__' + cell.elem : cell.block;
                    (acc[classId] || (acc[classId] = [])).push(cell);
                    return acc;
                }, {});

            const imports = Object.keys(entities).map(k => {
                const className = bemjsonToJSX.tagToClass(k);
                return `import ${className} from '${bemImport.stringify(entities[k])}';`
            });

            bemPath && imports.push(`import Bem from '${bemPath}';`);

            const whiteListPlugin = function(jsx, json) {
                // Plugin to fullfill css-only blocks
                if (jsx.bemEntity) {
                    if (!jsList.some(white => jsx.bemEntity.isEqual(white))) {
                        if (
                            bemPath &&
                            cssList.some(white => jsx.bemEntity.isEqual(white) || jsx.bemEntity.belongsTo(white))
                        ) {
                            jsx.tag = 'bem';
                            jsx.props.block = json.block;
                            json.mods && (jsx.props.mods = json.mods);
                            json.elem && (jsx.props.elem = json.elem);
                            json.elemMods && (jsx.props.elemMods = json.elemMods);
                            jsx.bemEntity = new BemEntity({ block: 'bem' });
                        } else {
                            // no js, no css
                            return '';
                        }
                    }
                }
            };
            const JSX = bemjsonToJSX().use([whiteListPlugin].concat(plugins)).process(bemjson).JSX;

            const res = reactTMPL(imports.join('\n'), JSX);
            is_debug && fs.writeFileSync('/tmp/debug-jsx.html', res);
            resolve(res);
        });
    })
    .then(res => callback(null, res))
    .catch(callback);
};
