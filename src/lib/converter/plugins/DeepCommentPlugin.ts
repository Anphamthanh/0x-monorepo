import {Reflection, SignatureReflection, ProjectReflection, TypeParameterReflection} from "../../models/reflections/index";
import {Comment, CommentTag} from "../../models/comments/index";
import {Converter} from "../converter";
import {ConverterPlugin} from "../plugin";
import {Context} from "../context";


/**
 * A handler that moves comments with dot syntax to their target.
 */
export class DeepCommentPlugin extends ConverterPlugin
{
    /**
     * Create a new CommentHandler instance.
     *
     * @param converter  The converter this plugin should be attached to.
     */
    constructor(converter:Converter) {
        super(converter);

        converter.on(Converter.EVENT_RESOLVE_BEGIN, this.onBeginResolve, this, 512);
    }


    /**
     * Triggered when the converter begins resolving a project.
     *
     * @param context  The context object describing the current state the converter is in.
     */
    private onBeginResolve(context:Context) {
        var project = context.project;
        var name:string;
        for (var key in project.reflections) {
            var reflection = project.reflections[key];
            if (!reflection.comment) {
                findDeepComment(reflection);
            }
        }


        function push(parent:Reflection) {
            var part = parent.originalName;
            if (!part || part.substr(0, 2) == '__' || parent instanceof SignatureReflection) {
                part = '';
            }

            if (part && part != '') {
                name = (name == '' ? part : part + '.' + name);
            }
        }


        function findDeepComment(reflection:Reflection) {
            name = '';
            push(reflection);
            var target = reflection.parent;

            while (target && !(target instanceof ProjectReflection)) {
                push(target);
                if (target.comment) {
                    var tag:CommentTag;
                    if (reflection instanceof TypeParameterReflection) {
                        tag = target.comment.getTag('typeparam', reflection.name);
                        if (!tag) tag = target.comment.getTag('param', '<' + reflection.name + '>');
                    }

                    if (!tag) tag = target.comment.getTag('param', name);

                    if (tag) {
                        target.comment.tags.splice(target.comment.tags.indexOf(tag), 1);
                        reflection.comment = new Comment('', tag.text);
                        break;
                    }
                }

                target = target.parent;
            }
        }
    }
}


/**
 * Register this handler.
 */
Converter.registerPlugin('deepComment', DeepCommentPlugin);
